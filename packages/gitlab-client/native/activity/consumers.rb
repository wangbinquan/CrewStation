# frozen_string_literal: true

# Inspect every visible thread's descriptors, mappings and filesystem context.
# Never read the contents of a project file or signal a process.
require 'fiddle'

module CrewstationGitlabActivity
  class Consumers
    LIMIT = 100_000

    def initialize(identities, processes = nil)
      raise 'native-source-activity-identities-invalid' unless identities.is_a?(Array) && identities.length <= LIMIT
      @targets = {}
      identities.each do |row|
        raise 'native-source-activity-identity-invalid' unless [%w[device inode], %w[birthtimeNs device inode]].include?(row.keys.sort) &&
          row.values.all? { |value| value.is_a?(String) && value.match?(/\A(?:0|[1-9][0-9]{0,19})\z/) && value.to_i <= 18_446_744_073_709_551_615 } &&
          row['inode'] != '0' && row['birthtimeNs'] != '0'
        births = (@targets[[row['device'], row['inode']]] ||= [])
        value = row['birthtimeNs']
        raise 'native-source-activity-identities-duplicate' if births.include?(value) || !births.empty? && (value.nil? || births.include?(nil))
        births << value
      end
      @references = []
      @inspected = 0
      @processes = processes
    end

    def read
      before = pids
      before.each do |pid|
        process = status("/proc/#{pid}/stat")
        expected = @processes && @processes.find { |row| row['pid'] == pid }
        raise 'native-source-activity-process-substituted' if expected && (expected['startedTick'] != process[:tick] || expected['uid'] != Process.euid.to_s)
        next if process[:state] == 'Z'
        threads = ids("/proc/#{pid}/task")
        threads.each { |tid| thread(pid, tid, process[:tick]) }
        raise 'native-source-activity-process-changed' unless status("/proc/#{pid}/stat")[:tick] == process[:tick] && ids("/proc/#{pid}/task") == threads
      end
      raise 'native-source-activity-process-set-changed' unless pids == before
      @references.sort_by { |row| [row[:pid], row[:tid], row[:kind], row[:device], row[:inode], row[:birthtimeNs].to_s] }
    end

    private

    def ids(path)
      Dir.children(path).grep(/\A[1-9][0-9]*\z/).map(&:to_i).sort
    end

    def pids
      @processes ? @processes.map { |row| row.fetch('pid') }.sort : ids('/proc')
    end

    def status(path)
      raw = File.read(path)
      close = raw.rindex(') ')
      raise 'native-source-activity-stat-invalid' unless close
      fields = raw[(close + 2)..].split
      tick = fields.fetch(19)
      raise 'native-source-activity-stat-invalid' unless tick.match?(/\A[1-9][0-9]*\z/)
      { state: fields.fetch(0), tick: tick }
    end

    def reference(pid, tid, started, kind, device, inode, path, fallback = nil)
      @inspected += 1
      raise 'native-source-activity-inspection-budget' if @inspected > 2_000_000
      births = @targets[[device, inode]]
      return unless births
      actual = kind == 'mapping' ? mapping_birth(path, fallback, device, inode) : birth(path, device, inode) unless births.include?(nil)
      # An unavailable birth remains a possible original consumer. A positively
      # different birth proves inode reuse, independently of path or process name.
      return if actual && !births.include?(actual)
      raise 'native-source-activity-reference-budget' if @references.length >= LIMIT
      row = { pid: pid, tid: tid, startedTick: started, kind: kind, device: device, inode: inode }
      row[:birthtimeNs] = actual if actual
      @references << row
    end

    def birth(path, device, inode)
      before = File.stat(path)
      raise 'native-source-activity-file-changed' unless before.dev.to_s == device && before.ino.to_s == inode
      @statx ||= Fiddle::Function.new(Fiddle.dlopen(nil)['statx'],
        [Fiddle::TYPE_INT, Fiddle::TYPE_VOIDP, Fiddle::TYPE_INT, Fiddle::TYPE_INT, Fiddle::TYPE_VOIDP], Fiddle::TYPE_INT)
      data = Fiddle::Pointer.malloc(256, Fiddle::RUBY_FREE)
      return nil unless @statx.call(-100, path, 0, 0xfff, data).zero? && (data[0, 4].unpack1('L') & 0x800) != 0
      major, minor = data[136, 8].unpack('LL')
      observed_device = ((major & 0xfff) << 8) | (minor & 0xff) | ((minor & 0xfff00) << 12) | ((major & ~0xfff) << 32)
      after = File.stat(path)
      raise 'native-source-activity-file-changed' unless observed_device.to_s == device && data[32, 8].unpack1('Q').to_s == inode && after.dev == before.dev && after.ino == before.ino
      seconds, nanos = data[80, 16].unpack('qL')
      value = seconds * 1_000_000_000 + nanos
      value.positive? && value <= 18_446_744_073_709_551_615 ? value.to_s : nil
    rescue Errno::EACCES, Errno::EPERM, Fiddle::DLError
      nil
    end

    def mapping_birth(path, fallback, device, inode)
      value = birth(path, device, inode)
      return value if value
      path_birth(fallback, device, inode)
    rescue Errno::ENOENT
      path_birth(fallback, device, inode)
    end

    def path_birth(path, device, inode)
      return nil if !path || path.empty? || path.end_with?(' (deleted)')
      stat = File.stat(path)
      return nil unless stat.dev.to_s == device && stat.ino.to_s == inode
      birth(path, device, inode)
    rescue Errno::ENOENT, Errno::EACCES, Errno::EPERM
      nil
    end

    def descriptor(pid, tid, started, kind, path)
      stat = File.stat(path)
      reference(pid, tid, started, kind, stat.dev.to_s, stat.ino.to_s, path)
    rescue Errno::ENOENT
      # A descriptor closed while scanning is no longer a consumer. The owning
      # thread's original birth is checked again after all reads.
      raise unless kind == 'descriptor'
    end

    def thread(pid, tid, process_started)
      path = "/proc/#{pid}/task/#{tid}"
      before = status(path + '/stat')
      return if before[:state] == 'Z'
      started = process_started
      Dir.children(path + '/fd').grep(/\A[0-9]+\z/).each { |fd| descriptor(pid, tid, started, 'descriptor', path + '/fd/' + fd) }
      %w[cwd root exe].each do |name|
        descriptor(pid, tid, started, { 'cwd' => 'cwd', 'root' => 'root', 'exe' => 'executable' }.fetch(name), path + '/' + name)
      end
      File.foreach(path + '/maps') do |line|
        fields = line.split(' ', 6)
        raise 'native-source-activity-mapping-invalid' unless fields.length >= 5 && fields[3].match?(/\A[0-9a-f]+:[0-9a-f]+\z/) && fields[4].match?(/\A[0-9]+\z/)
        next if fields[4] == '0'
        major, minor = fields[3].split(':').map { |value| value.to_i(16) }
        device = ((major & 0xfff) << 8) | (minor & 0xff) | ((minor & 0xfff00) << 12) | ((major & ~0xfff) << 32)
        reference(pid, tid, started, 'mapping', device.to_s, fields[4], path + '/map_files/' + fields[0], fields[5]&.strip)
      end
      raise 'native-source-activity-thread-changed' unless status(path + '/stat')[:tick] == before[:tick]
    end
  end
end
