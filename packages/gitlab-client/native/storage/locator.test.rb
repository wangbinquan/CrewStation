# frozen_string_literal: true

require_relative 'reader' unless defined?(CrewstationGitlabStorage::Reader)
require_relative 'locator' unless defined?(CrewstationGitlabStorage::Locator)
require 'tmpdir'
require 'fileutils'

module CrewstationGitlabFootprintTest
  def self.assert(value, message)
    raise message unless value
  end

  def self.rejects(pattern)
    begin
      yield
    rescue StandardError => error
      assert(error.message.match?(pattern), "unexpected rejection: #{error.class}: #{error.message}")
      return
    end
    raise 'unsafe project footprint accepted'
  end

  def self.run
    Dir.mktmpdir('crewstation-footprint-') do |base|
      roots = CrewstationGitlabStorage::ROOTS.map do |kind|
        path = File.join(base, kind)
        Dir.mkdir(path)
        identity = File.open(path) { |file| CrewstationGitlabStorage.metadata(file).slice(:device, :inode, :birthtimeNs, :kind).transform_keys(&:to_s) }
        { 'kind' => kind, 'path' => path, 'configuredPath' => path, 'identity' => identity }
      end
      root = ->(kind) { roots.find { |row| row['kind'] == kind }.fetch('path') }
      digest = Digest::SHA256.hexdigest('383')
      prefix = [digest[0, 2], digest[2, 2], digest].join('/')
      disk = '@hashed/' + prefix
      original = { 'project' => { 'id' => '383', 'diskPath' => disk, 'storage' => 'default' }, 'roots' => roots, 'categories' => [], 'nativeRevision' => 'a' * 64 }
      write = lambda do |kind, relative|
        path = File.join(root.call(kind), relative)
        FileUtils.mkdir_p(File.dirname(path))
        File.write(path, 'owned fixture')
      end
      write.call('repository', disk + '.git/objects/kept.pack')
      write.call('repository', disk + '.wiki.git/owned')
      captured = JSON.parse(JSON.generate(CrewstationGitlabStorage::Reader.new('roots' => roots, 'request' => { 'locations' =>
        %w[.git .wiki.git].map { |suffix| { 'key' => suffix, 'root' => 'repository', 'relative' => disk + suffix, 'mode' => 'tree' } } }).read))
      write.call('upload', disk + '/orphan/file')
      write.call('artifact', prefix + '/pipelines/old/artifacts/orphan')
      write.call('package', prefix + '/packages/old/files/orphan')
      write.call('secure-file', prefix + '/secure_files/old/orphan')
      write.call('artifact', '2024_01/383/old/artifact')
      write.call('trace', '2024_01/383/old.log')
      write.call('trace', '2026_10/383/later.log')
      write.call('trace', '2024_01/384/foreign.log')
      foreign = Digest::SHA256.hexdigest('384')
      foreign_repo = '+gitaly/tmp/' + foreign + '.git+removed-123/repo/foreign'
      write.call('repository', foreign_repo)
      retained = '+gitaly/tmp/' + digest + '.wiki.git+removed-123/repo/owned'
      FileUtils.mkdir_p(File.dirname(File.dirname(File.join(root.call('repository'), retained))))
      File.rename(File.join(root.call('repository'), disk + '.wiki.git'), File.join(root.call('repository'), File.dirname(retained)))
      input = -> { { 'roots' => roots, 'original' => original, 'retained' => captured } }
      read = -> { CrewstationGitlabStorage::Locator.new(input.call).locate }
      first = read.call
      rows = first.fetch(:inventory).fetch(:locations)
      assert(rows.flat_map { |row| row[:entries] }.count { |row| row[:kind] == 'file' } == 9, 'prefix or orphan coverage incomplete')
      assert(rows.none? { |row| row['relative'].include?(foreign) || row['relative'].include?('/384/') }, 'foreign scope included')
      assert(rows.any? { |row| row['relative'] == '2024_01/383' && row['root'] == 'artifact' }, 'legacy artifact prefix absent')
      assert(rows.any? { |row| row['relative'] == '+gitaly/tmp/' + digest + '.wiki.git+removed-123' }, 'retained native removal directory absent')
      assert(first[:nativeRevision] == original['nativeRevision'] && !first[:inventory][:physicalReclamationProven], 'observation became cleanup proof')
      # A different project's snippet can have the same numeric ID and hence
      # the same basename. Its original directory birth must never be erased.
      colliding = '+gitaly/tmp/' + digest + '.git+removed-FOREIGN/repo/foreign'
      write.call('repository', colliding)
      rejects(/retention-unproven/) { read.call }
      assert(File.read(File.join(root.call('repository'), colliding)) == 'owned fixture', 'colliding foreign retention changed')
      FileUtils.rm_rf(File.join(root.call('repository'), '+gitaly/tmp/' + digest + '.git+removed-FOREIGN'))
      # A retained Build can point at a month directory already removed by GitLab.
      # Its absence still needs an explicit descriptor-based location check.
      original['categories'] = [{ 'objects' => [{ 'model' => 'Ci::Build', 'path' => File.join(root.call('trace'), '2025_01/383/absent.log') }] }]
      assert(read.call[:inventory][:locations].any? { |row| row['root'] == 'trace' && row['relative'] == '2025_01/383' && !row[:present] }, 'retained absent month not covered')
      original['categories'] = []
      FileUtils.rm_rf(File.join(root.call('repository'), disk + '.git'))
      assert(read.call[:inventory][:locations].any? { |row| row['relative'] == disk + '.git' && !row[:present] }, 'parent absence concealed retention')

      oid = 'b' * 64
      lfs = [oid[0, 2], oid[2, 2], oid[4..]].join('/')
      write.call('lfs', lfs)
      original['categories'] = [{ 'objects' => [{ 'model' => 'LfsObject', 'projectIds' => ['383'], 'oid' => oid, 'path' => File.join(root.call('lfs'), lfs) }] }]
      assert(read.call[:inventory][:locations].any? { |row| row['root'] == 'lfs' && row['relative'] == lfs && row[:present] }, 'exclusive LFS original missing')
      original['categories'][0]['objects'][0]['projectIds'] << '384'
      rejects(/lfs-shared/) { read.call }
      original['categories'][0]['objects'][0]['projectIds'] = ['383']
      original['categories'][0]['objects'][0]['path'] = File.join(root.call('lfs'), 'foreign')
      rejects(/lfs-location-unsupported/) { read.call }
      original['categories'] = [{ 'objects' => [{ 'model' => 'Upload', 'path' => File.join(root.call('upload'), 'foreign/file') }] }]
      rejects(/file-unowned/) { read.call }
      original['categories'] = [{ 'objects' => [{ 'model' => 'Ci::BuildTraceChunk', 'store' => 'redis' }] }]
      rejects(/trace-store-unsupported/) { read.call }
      original['categories'] = []
      File.symlink(File.join(root.call('trace'), '2024_01'), File.join(root.call('trace'), '2024_02'))
      rejects(/Too many levels|symbolic link/i) { read.call }
      File.unlink(File.join(root.call('trace'), '2024_02'))
      original['project']['diskPath'] = '@hashed/foreign'
      rejects(/layout-unsupported/) { read.call }
      original['project']['diskPath'] = disk
      write.call('repository', '+gitaly/tmp/' + digest + '.git+removed-bad.name/repo/bytes')
      rejects(/retention-name/) { read.call }
      FileUtils.rm_rf(File.join(root.call('repository'), '+gitaly/tmp/' + digest + '.git+removed-bad.name'))
      File.rename(root.call('package'), root.call('package') + '-old')
      Dir.mkdir(root.call('package'))
      rejects(/original-root-changed/) { read.call }
      assert(File.read(File.join(root.call('trace'), '2024_01/384/foreign.log')) == 'owned fixture', 'foreign file changed')
      assert(File.read(File.join(root.call('repository'), foreign_repo)) == 'owned fixture', 'foreign retention changed')
      puts JSON.generate({ standaloneFootprintCases: 14, originalProjectTouched: false, foreignFilesRetained: true })
    end
  end
end

CrewstationGitlabFootprintTest.run
