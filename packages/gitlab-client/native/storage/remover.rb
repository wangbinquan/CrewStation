# frozen_string_literal: true

# Loaded after reader.rb. Only original, fully enumerated descriptor identities
# may be unlinked; the host must independently close writers and consumers first.
module CrewstationGitlabStorage
  class Remover
    def initialize(input)
      raise 'native-source-removal-input-invalid' unless input.is_a?(Hash) && input.keys.sort == %w[original roots].sort
      @roots = input.fetch('roots'); @original = input.fetch('original')
      raise 'native-source-removal-snapshot-invalid' unless @original['version'] == 1 && @original['readonly'] == true && @original['complete'] == true &&
        @original['revision'] == CrewstationGitlabStorage.digest({ roots: @original['roots'], locations: @original['locations'] }) && @original['roots'] == @roots
      @locations = @original.fetch('locations').map { |row| row.slice('key', 'root', 'relative', 'mode') }
      @input = { 'roots' => @roots, 'request' => { 'locations' => @locations } }
      @expected = {}; @original.fetch('locations').each { |row| row.fetch('entries').each { |item| @expected[[row.fetch('root'), item.fetch('path')]] = item } }
      @removed = 0; @opened_roots = {}
    end

    def remove
      current = Reader.new(@input).read
      validate(current)
      open_roots
      @locations.each { |location| erase_location(location) }
      close_roots
      after = Reader.new(@input).read
      raise 'native-source-removal-residual' if after[:locations].any? { |row| row[:present] || !row[:entries].empty? }
      facts = { originalRevision: @original.fetch('revision'), remainingRevision: after[:revision], removedEntries: @removed,
        locations: @locations, roots: @roots }
      facts.merge(version: 1, observedAt: Time.now.utc.iso8601(3), revision: CrewstationGitlabStorage.digest(facts), runtime: after[:runtime],
        physicalReclamationProven: false, producersClosed: false, consumersStopped: false)
    ensure
      close_roots
    end

    private

    def validate(current)
      @original.fetch('locations').each_with_index do |expected, index|
        actual = JSON.parse(JSON.generate(current[:locations].fetch(index)))
        raise 'native-source-removal-location-substituted' if !expected.fetch('present') && actual.fetch('present')
        actual.fetch('entries').each do |entry|
          original = @expected[[actual.fetch('root'), entry.fetch('path')]]
          assert_entry(original, entry)
          raise 'native-source-removal-shared-file' if entry['kind'] == 'file' && entry.fetch('links') != 1
        end
      end
      # Overlapping locations must not let one deletion invalidate another scope.
      @locations.each_with_index do |row, index|
        raise 'native-source-removal-overlap' if @locations.each_with_index.any? do |other, other_index|
          index != other_index && row['root'] == other['root'] &&
            (row['relative'] == other['relative'] || row['relative'].start_with?(other['relative'] + '/'))
        end
      end
    end

    def assert_entry(original, actual)
      fields = %w[kind device inode birthtimeNs identity mode]
      fields += %w[bytes allocatedBytes links mtimeNs ctimeNs] if actual['kind'] == 'file'
      raise 'native-source-removal-entry-substituted' unless original && fields.all? { |key| original[key] == actual[key] }
    end

    def open_roots
      @roots.each do |binding|
        path = binding.fetch('path')
        raise 'native-source-removal-root-alias' unless File.realpath(path) == path
        file = File.open(path, OPEN_FLAGS)
        @opened_roots[binding.fetch('kind')] = file
        facts = CrewstationGitlabStorage.metadata(file)
        raise 'native-source-removal-root-substituted' unless facts.slice(:device, :inode, :birthtimeNs, :kind).transform_keys(&:to_s) == binding.fetch('identity')
      end
    end

    def erase_location(location)
      root = location.fetch('root'); parent = @opened_roots.fetch(root)
      parts = CrewstationGitlabStorage.relative(location.fetch('relative')); opened = []
      begin
        parts[0...-1].each do |part|
          begin
            file = File.open("/proc/self/fd/#{parent.fileno}/#{part}", OPEN_FLAGS)
          rescue Errno::ENOENT
            return
          end
          opened << file
          raise 'native-source-removal-parent-kind-changed' unless file.stat.directory? && file.stat.dev == @opened_roots.fetch(root).stat.dev
          parent = file
        end
        erase(parent, parts.last, root, location.fetch('relative'), 0)
      ensure
        opened.reverse_each(&:close)
      end
    end

    def erase(parent, name, root, relative, depth)
      raise 'native-source-removal-depth-exceeded' if depth > 48
      path = "/proc/self/fd/#{parent.fileno}/#{name}"
      begin
        file = File.open(path, OPEN_FLAGS)
      rescue Errno::ENOENT
        return
      end
      begin
        actual = CrewstationGitlabStorage.metadata(file).transform_keys(&:to_s)
        assert_entry(@expected[[root, relative]], actual)
        if actual.fetch('kind') == 'directory'
          Dir.children("/proc/self/fd/#{file.fileno}").sort.each do |child|
            CrewstationGitlabStorage.name(child); erase(file, child, root, relative + '/' + child, depth + 1)
          end
          # Validate the original directory again immediately before unlinking.
          assert_entry(@expected[[root, relative]], CrewstationGitlabStorage.metadata(file).transform_keys(&:to_s))
          Dir.rmdir(path)
        else
          raise 'native-source-removal-shared-file' unless actual.fetch('links') == 1
          File.unlink(path)
        end
        @removed += 1
      ensure
        file.close
      end
    end

    def close_roots
      @opened_roots.each_value { |file| file.close unless file.closed? }
      @opened_roots.clear
    end
  end
end

if ENV['CS_GITLAB_STORAGE_REMOVE'] == '1'
  raw = STDIN.read(8_388_609)
  raise 'native-source-removal-request-budget' if raw.bytesize > 8_388_608
  encoded = Timeout.timeout(80) { JSON.generate(CrewstationGitlabStorage::Remover.new(JSON.parse(raw)).remove) }
  raise 'native-source-removal-output-budget' if encoded.bytesize + 18 > 8_388_608
  puts 'CS_GITLAB_REMOVAL=' + encoded
end
