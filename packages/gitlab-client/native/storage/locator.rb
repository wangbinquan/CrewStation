# frozen_string_literal: true

# Enumerate project prefixes independently of Rails. Retained repository paths
# are also checked under Gitaly's removal directory after the parent is gone.
require 'digest'

module CrewstationGitlabStorage
  class Locator < Reader
    def initialize(input)
      raise 'native-source-footprint-input-invalid' unless input.is_a?(Hash) && (input.keys.sort == %w[original roots].sort || input.keys.sort == %w[original retained roots].sort)
      @original = input.fetch('original')
      @retained = input['retained']
      @project = @original.fetch('project')
      id = @project.fetch('id')
      raise 'native-source-footprint-id-invalid' unless id.match?(/\A[1-9][0-9]*\z/) && id.to_i <= MAX_INTEGER
      @hash = Digest::SHA256.hexdigest(id)
      @prefix = [@hash[0, 2], @hash[2, 2], @hash].join('/')
      raise 'native-source-footprint-layout-unsupported' unless @project.fetch('diskPath') == '@hashed/' + @prefix
      raise 'native-source-footprint-roots-changed' unless input.fetch('roots') == @original.fetch('roots')
      raise 'native-source-footprint-roots-changed' if @retained && @retained.fetch('roots') != input.fetch('roots')
      @requested = []
      @index_files = []
      @index_stamps = {}
      super('roots' => input.fetch('roots'), 'request' => { 'locations' => [{ 'key' => 'initial', 'root' => 'repository', 'relative' => @project['diskPath'] + '.git', 'mode' => 'tree' }] })
    end

    def locate
      open_roots
      repository_paths.each { |path| add('repository', path, 'tree') }
      add('upload', @project.fetch('diskPath'), 'tree')
      %w[artifact package secure-file].each { |kind| add(kind, @prefix, 'tree') }
      %w[artifact trace].each do |kind|
        indexed_children(kind, '').grep(/\A[0-9]{4}_(?:0[1-9]|1[0-2])\z/).each do |month|
          add(kind, month + '/' + @project.fetch('id'), 'tree')
        end
      end
      captured_files
      retained_repositories
      raise 'native-source-footprint-location-budget' if @requested.length > 128
      request = { 'locations' => @requested.sort_by { |row| [row['root'], row['relative']] } }
      result = Reader.new('roots' => @bindings, 'request' => request).read
      verify_indexes
      { version: 1, nativeRevision: @original.fetch('nativeRevision'), inventory: result }
    ensure
      @index_files.each { |file| file.close unless file.closed? }
      @roots.each_value { |root| root[:file].close unless root[:file].closed? }
    end

    private

    def objects
      @original.fetch('categories').flat_map { |category| category.fetch('objects') }
    end

    def repository_paths
      paths = %w[.git .wiki.git .design.git].map { |suffix| @project.fetch('diskPath') + suffix }
      objects.select { |row| row['model'] == 'SnippetRepository' }.each do |row|
        disk = row.fetch('diskPath')
        raise 'native-source-footprint-snippet-unsupported' unless row.fetch('storage') == @project.fetch('storage') &&
          disk.match?(/\A@snippets\/[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{64}\z/)
        paths << disk + '.git'
      end
      paths.uniq
    end

    def add(root, relative, mode)
      CrewstationGitlabStorage.relative(relative)
      # A complete project subtree includes captured children and orphan files.
      return if @requested.any? { |row| row['root'] == root && (row['relative'] == relative || row['mode'] == 'tree' && relative.start_with?(row['relative'] + '/')) }
      @requested.reject! { |row| row['root'] == root && mode == 'tree' && row['relative'].start_with?(relative + '/') }
      @requested << { 'key' => root + ':' + relative, 'root' => root, 'relative' => relative, 'mode' => mode }
      raise 'native-source-footprint-location-budget' if @requested.length > 128
    end

    def relative_file(row, kind)
      binding = @bindings.find { |root| root['kind'] == kind }
      path = row.fetch('path')
      candidates = [binding.fetch('path'), binding.fetch('configuredPath')].uniq
      parent = candidates.find { |root| path.start_with?(root + '/') }
      raise 'native-source-footprint-file-outside-root' unless parent
      relative = path[(parent.length + 1)..]
      CrewstationGitlabStorage.relative(relative)
      relative
    end

    def captured_files
      objects.each do |row|
        if row['model'] == 'Ci::BuildTraceChunk'
          raise 'native-source-footprint-trace-store-unsupported' unless row.fetch('store') == 'database'
        end
        kind = { 'LfsObject' => 'lfs', 'Upload' => 'upload', 'Ci::JobArtifact' => 'artifact', 'Ci::PipelineArtifact' => 'artifact',
          'Ci::Build' => 'trace', 'Packages::PackageFile' => 'package', 'Ci::SecureFile' => 'secure-file' }[row['model']]
        next unless kind
        relative = relative_file(row, kind)
        if kind == 'lfs'
          raise 'native-source-footprint-lfs-shared' unless row.fetch('projectIds') == [@project.fetch('id')]
          oid = row.fetch('oid')
          raise 'native-source-footprint-lfs-location-unsupported' unless oid.match?(/\A[a-f0-9]{64}\z/) && relative == [oid[0, 2], oid[2, 2], oid[4..]].join('/')
          add(kind, relative, 'file')
        else
          if %w[artifact trace].include?(kind) && relative.match?(/\A[0-9]{4}_(?:0[1-9]|1[0-2])\/#{Regexp.escape(@project.fetch('id'))}\//)
            add(kind, relative.split('/').first(2).join('/'), 'tree')
          end
          raise 'native-source-footprint-file-unowned' unless @requested.any? { |item| item['root'] == kind && item['mode'] == 'tree' && relative.start_with?(item['relative'] + '/') }
        end
      end
    end

    def indexed_children(kind, relative)
      root = @roots.fetch(kind)
      file = root[:file]
      path = root[:path]
      unless relative.empty?
        CrewstationGitlabStorage.relative(relative).each do |part|
          path = File.join(path, part)
          begin
            file = File.open("/proc/self/fd/#{file.fileno}/#{part}", OPEN_FLAGS)
          rescue Errno::ENOENT
            @missing << path
            return []
          end
          @index_files << file
          raise 'native-source-footprint-index-kind' unless file.stat.directory?
        end
      end
      facts = remember(file, path, root)
      @index_stamps[path] = facts[:stamp]
      names = Dir.children("/proc/self/fd/#{file.fileno}").sort
      raise 'native-source-footprint-index-budget' if names.length > LIMIT
      names.each { |name| CrewstationGitlabStorage.name(name) }
      names
    end

    def retained_repositories
      names = indexed_children('repository', '+gitaly/tmp')
      basenames = repository_paths.map { |path| File.basename(path) }
      originals = @retained ? @retained.fetch('locations').select { |row| row['root'] == 'repository' }.flat_map { |row| row.fetch('entries') }
        .select { |row| row['kind'] == 'directory' && repository_paths.include?(row['path']) }.map { |row| row.fetch('identity') } : []
      repository_paths.each do |relative|
        begin
          File.open(File.join(@roots.fetch('repository')[:path], relative), OPEN_FLAGS) do |file|
            value = CrewstationGitlabStorage.metadata(file)
            captured = @retained && @retained.fetch('locations').flat_map { |row| row.fetch('entries') }.find { |row| row['path'] == relative && row['kind'] == 'directory' }
            raise 'native-source-footprint-repository-substituted' if captured && captured['identity'] != value[:identity]
            originals << value[:identity]
          end
        rescue Errno::ENOENT
          next
        end
      end
      names.each do |name|
        basename = basenames.find { |value| name.start_with?(value + '+removed-') }
        next unless basename
        raise 'native-source-footprint-retention-name' unless name.match?(/\A#{Regexp.escape(basename)}\+removed-[a-zA-Z0-9]+\z/)
        relative = '+gitaly/tmp/' + name
        # Project and snippet IDs use the same SHA256 basename namespace. A
        # matching name alone could identify a different project's snippet.
        raise 'native-source-footprint-retention-unproven' unless indexed_children('repository', relative) == ['repo']
        File.open(File.join(@roots.fetch('repository')[:path], relative, 'repo'), OPEN_FLAGS) do |file|
          raise 'native-source-footprint-retention-unproven' unless originals.include?(CrewstationGitlabStorage.metadata(file)[:identity])
        end
        add('repository', '+gitaly/tmp/' + name, 'tree')
      end
    end

    def verify_indexes
      @index_stamps.each do |path, stamp|
        File.open(path, OPEN_FLAGS) do |file|
          raise 'native-source-footprint-index-changed' unless CrewstationGitlabStorage.metadata(file)[:stamp] == stamp
        end
      end
      @missing.each { |path| raise 'native-source-footprint-index-changed' if File.exist?(path) || File.symlink?(path) }
    end
  end
end

if ENV['CS_GITLAB_FOOTPRINT_READ'] == '1'
  raw = STDIN.read(8_388_609)
  raise 'native-source-footprint-request-budget' if raw.bytesize > 8_388_608
  puts 'CS_GITLAB_FOOTPRINT=' + JSON.generate(Timeout.timeout(80) { CrewstationGitlabStorage::Locator.new(JSON.parse(raw)).locate })
end
