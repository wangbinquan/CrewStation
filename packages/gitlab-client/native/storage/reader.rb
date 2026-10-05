# frozen_string_literal: true

# Independent of Rails models: retained paths remain observable after Project
# removal. Only descriptor metadata and directory names are read.
require 'json'
require 'digest'
require 'fiddle'
require 'time'
require 'timeout'

module CrewstationGitlabStorage
  ROOTS = %w[repository lfs upload artifact trace package secure-file].freeze
  LIMIT = 100_000
  MAX_INTEGER = 9_007_199_254_740_991
  OPEN_FLAGS = File::RDONLY | File::NOFOLLOW | File::NONBLOCK

  def self.canonical(value)
    case value
    when Hash then value.keys.sort_by(&:to_s).to_h { |key| [key.to_s, canonical(value[key])] }
    when Array then value.map { |item| canonical(item) }
    else value
    end
  end

  def self.digest(value)
    Digest::SHA256.hexdigest(JSON.generate(canonical(value)))
  end

  def self.name(value)
    raise 'native-source-storage-name-unsupported' unless value.is_a?(String) && value.valid_encoding? && !value.empty? && value.bytesize <= 4096 &&
      !value.match?(/[\x00-\x1f\x7f]/) && !value.include?('/') && !%w[. ..].include?(value)
    value
  end

  def self.relative(value)
    raise 'native-source-storage-path-unsupported' unless value.is_a?(String) && !value.empty? && value.bytesize <= 4096
    parts = value.split('/', -1)
    parts.each { |part| name(part) }
    parts
  end

  def self.metadata(file)
    stat = file.stat
    raise 'native-source-storage-entry-unsupported' unless stat.file? || stat.directory?
    call = Fiddle::Function.new(Fiddle.dlopen(nil)['statx'],
      [Fiddle::TYPE_INT, Fiddle::TYPE_VOIDP, Fiddle::TYPE_INT, Fiddle::TYPE_INT, Fiddle::TYPE_VOIDP], Fiddle::TYPE_INT)
    data = Fiddle::Pointer.malloc(256, Fiddle::RUBY_FREE)
    raise 'native-source-storage-statx-unavailable' unless call.call(file.fileno, '', 4096, 0xfff, data).zero? && (data[0, 4].unpack1('L') & 0x800) != 0
    seconds, nanos = data[80, 16].unpack('qL')
    birth = seconds * 1_000_000_000 + nanos
    raise 'native-source-storage-epoch-unavailable' unless birth.positive? && data[32, 8].unpack1('Q') == stat.ino
    bytes = stat.file? ? stat.size : 0
    allocated = stat.blocks * 512
    raise 'native-source-storage-size-unsupported' unless bytes.between?(0, MAX_INTEGER) && allocated.between?(0, MAX_INTEGER)
    identity = { device: stat.dev.to_s, inode: stat.ino.to_s, birthtimeNs: birth.to_s, kind: stat.directory? ? 'directory' : 'file' }
    facts = identity.merge(bytes: bytes, allocatedBytes: allocated, links: stat.nlink,
      mtimeNs: (stat.mtime.to_i * 1_000_000_000 + stat.mtime.nsec).to_s,
      ctimeNs: (stat.ctime.to_i * 1_000_000_000 + stat.ctime.nsec).to_s, mode: stat.mode)
    facts.merge(identity: digest(identity), stamp: digest(facts))
  end

  class Reader
    def initialize(input)
      raise 'native-source-storage-input-invalid' unless input.is_a?(Hash) && input.keys.sort == %w[request roots].sort
      @bindings = input.fetch('roots')
      raise 'native-source-storage-roots-invalid' unless @bindings.is_a?(Array) && @bindings.length == ROOTS.length && @bindings.map { |root| root['kind'] }.sort == ROOTS.sort
      @request = input.fetch('request')
      raise 'native-source-storage-request-invalid' unless @request.is_a?(Hash) && @request.keys.sort == %w[locations].sort
      locations = @request.fetch('locations')
      raise 'native-source-storage-locations-invalid' unless locations.is_a?(Array) && locations.length.between?(1, 128) && locations.map { |row| row['key'] }.uniq.length == locations.length
      locations.each do |row|
        raise 'native-source-storage-location-invalid' unless row.keys.sort == %w[key mode relative root].sort && row['key'].is_a?(String) && row['key'].bytesize.between?(1, 200) && ROOTS.include?(row['root']) && %w[file tree].include?(row['mode'])
        CrewstationGitlabStorage.relative(row.fetch('relative'))
      end
      @roots = {}; @observed = {}; @missing = []; @entries = 0
    end

    def read
      open_roots
      locations = @request.fetch('locations').map { |location| observe(location) }
      verify
      material = { roots: @bindings, locations: locations }
      material.merge(version: 1, readonly: true, complete: true, observedAt: Time.now.utc.iso8601(3),
        requestDigest: CrewstationGitlabStorage.digest(@request), revision: CrewstationGitlabStorage.digest(material), runtime: runtime,
        physicalReclamationProven: false, producersClosed: false, consumersStopped: false)
    ensure
      @roots.each_value { |root| root[:file].close unless root[:file].closed? }
    end

    private

    def open_roots
      @bindings.each do |binding|
        path = binding.fetch('path')
        raise 'native-source-storage-root-alias' unless path.start_with?('/') && File.realpath(path) == path
        file = File.open(path, OPEN_FLAGS)
        begin
          facts = CrewstationGitlabStorage.metadata(file)
          expected = binding.fetch('identity')
          identity = facts.slice(:device, :inode, :birthtimeNs, :kind).transform_keys(&:to_s)
          raise 'native-source-storage-original-root-changed' unless identity == expected
          @roots[binding.fetch('kind')] = { file: file, path: path, device: facts[:device] }
          @observed[path] = facts[:stamp]
        rescue Exception
          file.close
          raise
        end
      end
    end

    def remember(file, path, root)
      facts = CrewstationGitlabStorage.metadata(file)
      raise 'native-source-storage-crossed-device' unless facts[:device] == root[:device]
      raise 'native-source-storage-entry-changed' if @observed.key?(path) && @observed[path] != facts[:stamp]
      @observed[path] = facts[:stamp]
      facts
    end

    def entry(file, path, relative, root)
      raise 'native-source-storage-budget-exceeded' if @entries >= LIMIT
      @entries += 1
      facts = remember(file, path, root)
      facts.reject { |key, _value| key == :stamp }.merge(path: relative)
    end

    def observe(location)
      root = @roots.fetch(location.fetch('root'))
      parts = CrewstationGitlabStorage.relative(location.fetch('relative'))
      current = root[:file]; opened = []; relative = ''; path = root[:path]
      begin
        parts.each_with_index do |part, index|
          relative = relative.empty? ? part : relative + '/' + part
          path = File.join(root[:path], relative)
          begin
            child = File.open("/proc/self/fd/#{current.fileno}/#{part}", OPEN_FLAGS)
          rescue Errno::ENOENT
            @missing << path
            return location.merge(present: false, entries: [])
          end
          opened << child; current = child
          facts = remember(child, path, root)
          raise 'native-source-storage-location-kind-changed' if (index < parts.length - 1 || location['mode'] == 'tree') && facts[:kind] != 'directory'
        end
        first = entry(current, path, relative, root)
        raise 'native-source-storage-location-kind-changed' if location['mode'] == 'file' && first[:kind] != 'file'
        entries = [first]
        walk(current, path, relative, root, entries, 0) if location['mode'] == 'tree'
        location.merge(present: true, entries: entries)
      ensure
        opened.reverse_each(&:close)
      end
    end

    def walk(parent, parent_path, relative, root, entries, depth)
      raise 'native-source-storage-depth-exceeded' if depth >= 48
      Dir.children("/proc/self/fd/#{parent.fileno}").sort.each do |name|
        CrewstationGitlabStorage.name(name)
        path = File.join(parent_path, name)
        child = File.open("/proc/self/fd/#{parent.fileno}/#{name}", OPEN_FLAGS)
        begin
          row = entry(child, path, relative + '/' + name, root)
          entries << row
          walk(child, path, row[:path], root, entries, depth + 1) if row[:kind] == 'directory'
        ensure
          child.close
        end
      end
    end

    def verify
      @observed.each do |path, expected|
        File.open(path, OPEN_FLAGS) do |file|
          raise 'native-source-storage-tree-changed' unless CrewstationGitlabStorage.metadata(file)[:stamp] == expected
        end
      end
      @missing.each do |path|
        begin
          File.lstat(path)
        rescue Errno::ENOENT
          next
        end
        raise 'native-source-storage-absence-changed'
      end
    end

    def runtime
      value = File.read('/proc/self/stat')
      { bootId: File.read('/proc/sys/kernel/random/boot_id').strip, namespace: File.readlink('/proc/self/ns/pid'),
        readerPid: Process.pid, readerStartedTick: value[value.rindex(') ') + 2..].split.fetch(19) }
    end
  end
end

if ENV['CS_GITLAB_STORAGE_READ'] == '1'
  raw = STDIN.read(65_537)
  raise 'native-source-storage-request-budget' if raw.bytesize > 65_536
  input = JSON.parse(raw)
  encoded = Timeout.timeout(80) { JSON.generate(CrewstationGitlabStorage::Reader.new(input).read) }
  raise 'native-source-storage-output-budget' if encoded.bytesize + 19 > 8_388_608
  puts 'CS_GITLAB_STORAGE=' + encoded
end
