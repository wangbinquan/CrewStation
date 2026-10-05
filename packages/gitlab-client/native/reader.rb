# frozen_string_literal: true

# Run only through the original installation's gitlab-rails runner. No model
# save/destroy, uploader retrieval, trace.ensure_metadata!, or content reads.
require 'json'
require 'digest'
require 'time'
require 'fiddle'
require 'toml-rb'
require 'timeout'

module CrewstationGitlabNative
  VERSION = '19.2.4'
  KINDS = %w[repository wiki design snippet lfs upload artifact trace package registry secure-file].freeze
  LIMIT = 100_000

  def self.id(value)
    raise 'native-source-invalid-id' unless value.to_s.match?(/\A[1-9][0-9]*\z/) && value.to_i <= 9_007_199_254_740_991
    value.to_i
  end

  def self.rows(relation, fields = [])
    result = []
    columns = relation.klass.column_names
    selected = (%w[id created_at partition_id] + fields.map(&:to_s)).uniq.select { |name| columns.include?(name) }
    relation.select(*selected).reorder(:id).find_each(batch_size: 200) do |row|
      raise 'native-source-budget-exceeded' if result.length >= LIMIT
      result << yield(row)
    end
    result
  end

  def self.readonly(base)
    base.transaction(isolation: :repeatable_read) do
      base.connection.execute('SET TRANSACTION READ ONLY')
      base.connection.execute("SET LOCAL statement_timeout = '10s'")
      yield
    end
  end

  def self.birth(row)
    result = { id: row.id.to_s, createdAt: row.respond_to?(:created_at) ? row.created_at&.utc&.iso8601(6) : nil }
    result[:partitionId] = row.partition_id.to_s if row.respond_to?(:partition_id)
    result
  end

  def self.canonical(value)
    case value
    when Hash then value.keys.sort_by(&:to_s).to_h { |key| [key.to_s, canonical(value[key])] }
    when Array then value.map { |item| canonical(item) }
    else value
    end
  end

  # Ruby's File::Stat#birthtime is unavailable in this installed Linux build.
  # libc statx gives the original epoch without substituting ctime for birth.
  def self.file_identity(path)
    stat = File.lstat(path)
    call = Fiddle::Function.new(Fiddle.dlopen(nil)['statx'],
      [Fiddle::TYPE_INT, Fiddle::TYPE_VOIDP, Fiddle::TYPE_INT, Fiddle::TYPE_INT, Fiddle::TYPE_VOIDP], Fiddle::TYPE_INT)
    data = Fiddle::Pointer.malloc(256, Fiddle::RUBY_FREE)
    raise 'native-source-statx-unavailable' unless call.call(-100, path, 256, 0xfff, data).zero? && (data[0, 4].unpack1('L') & 0x800) != 0
    seconds, nanos = data[80, 16].unpack('qL')
    epoch = seconds * 1_000_000_000 + nanos
    raise 'native-source-file-epoch-unavailable' unless epoch.positive? && data[32, 8].unpack1('Q') == stat.ino
    raise 'native-source-unsupported-file' unless stat.directory? || stat.file?
    { device: stat.dev.to_s, inode: stat.ino.to_s, birthtimeNs: epoch.to_s, kind: stat.directory? ? 'directory' : 'file' }
  end

  class Reader
    def initialize(input)
      raise 'native-source-version-unsupported' unless Gitlab::VERSION == VERSION
      raise 'native-source-invalid-request' unless input.keys.sort == %w[createdAt pathWithNamespace projectId tokenIds].sort
      @id = CrewstationGitlabNative.id(input.fetch('projectId'))
      @path = input.fetch('pathWithNamespace')
      @created = input.fetch('createdAt')
      raise 'native-source-invalid-path' unless @path.is_a?(String) && @path.bytesize <= 512 && @path.match?(/\A[^\x00-\x20\x7f]+\z/)
      ids = input.fetch('tokenIds')
      raise 'native-source-invalid-tokens' unless ids.is_a?(Array) && ids.length <= 10_000
      @token_ids = ids.map { |value| CrewstationGitlabNative.id(value) }.sort
      raise 'native-source-duplicate-token' unless @token_ids.uniq == @token_ids
    end

    def read
      before = main
      ci_before = ci
      ci_after = ci
      after = main
      raise 'native-source-metadata-changed' unless before == after && ci_before == ci_after
      categories = before.fetch(:categories).merge(ci_before.fetch(:categories))
      categories['artifact'] = before[:categories]['artifact'] + ci_before[:categories]['artifact']
      categories['trace'] = ci_before[:categories]['trace']
      raise 'native-source-category-missing' unless categories.keys.sort == KINDS.sort
      roots = before.fetch(:roots)
      facts = { project: before.fetch(:project), credentials: before.fetch(:credentials), roots: roots,
        categories: KINDS.map { |kind| { kind: kind, complete: true, objects: categories.fetch(kind) } }, pipelines: ci_before.fetch(:pipelines) }
      facts.merge(version: 'gitlab-native/19.2.4/v1', observedAt: Time.now.utc.iso8601(3), readonly: true,
        runtime: runtime, nativeRevision: Digest::SHA256.hexdigest(JSON.generate(CrewstationGitlabNative.canonical(facts))),
        physicalReclamationProven: false, producersClosed: false, consumersStopped: false)
    end

    private

    def runtime
      value = File.read('/proc/self/stat')
      { bootId: File.read('/proc/sys/kernel/random/boot_id').strip, namespace: File.readlink('/proc/self/ns/pid'),
        readerPid: Process.pid, readerStartedTick: value[value.rindex(') ') + 2..].split.fetch(19) }
    end

    def project
      row = Project.select(:id, :created_at, :path, :namespace_id, :repository_storage, :storage_version, :pool_repository_id, :archived).find(@id)
      raise 'native-source-original-project-changed' unless row.full_path == @path
      raise 'native-source-original-birth-changed' if @created && Time.iso8601(@created).utc.iso8601(3) != row.created_at.utc.iso8601(3)
      row
    end

    def roots(project)
      config = Tomlrb.load_file('/var/opt/gitlab/gitaly/config.toml')
      raise 'native-source-gitaly-wal-unsupported' if config.dig('transactions', 'enabled') || config.dig('transactions', 'recover_pending_wal')
      storage = config.fetch('storage').select { |entry| entry['name'] == project.repository_storage }
      address = Gitlab.config.repositories.storages.fetch(project.repository_storage).gitaly_address
      raise 'native-source-gitaly-location-unsupported' unless storage.length == 1 && address.start_with?('unix:')
      paths = { 'repository' => storage[0].fetch('path'), 'lfs' => LfsObjectUploader.root,
        'upload' => FileUploader.root, 'artifact' => JobArtifactUploader.root,
        'trace' => Settings.gitlab_ci.builds_path, 'package' => Packages::PackageFileUploader.root,
        'secure-file' => Ci::SecureFileUploader.root }
      paths.map do |kind, path|
        path = path.to_path if path.respond_to?(:to_path)
        raise 'native-source-root-path-unsupported:' + kind unless path.is_a?(String) && path.start_with?('/') && !path.split('/').include?('..')
        actual = File.exist?(path) ? File.realpath(path) : path
        raise 'native-source-root-location-unsupported:' + kind unless actual.start_with?('/var/opt/gitlab/')
        { kind: kind, path: actual, configuredPath: path, identity: File.exist?(actual) ? CrewstationGitlabNative.file_identity(actual) : nil }
      end
    end

    def entry(row, model, extra = {})
      CrewstationGitlabNative.birth(row).merge(model: model).merge(extra)
    end

    def uploaded(row, model, kind)
      raise 'native-source-remote-uploader-unsupported' unless row.file_store == ObjectStorage::Store::LOCAL
      file = row.file
      raise 'native-source-uploader-class-unsupported' unless file.class.name == {
        'LfsObject' => 'LfsObjectUploader', 'Ci::JobArtifact' => 'JobArtifactUploader',
        'Ci::PipelineArtifact' => 'Ci::PipelineArtifactUploader', 'Packages::PackageFile' => 'Packages::PackageFileUploader',
        'Ci::SecureFile' => 'Ci::SecureFileUploader'
      }.fetch(model)
      entry(row, model, kind: kind, path: file.path)
    end

    def credentials
      known = PersonalAccessToken.where(id: @token_ids).select(:user_id)
      bots = ProjectMember.where(source_id: @id, user_id: User.project_bot.select(:id)).select(:user_id)
      users = User.where(id: known).or(User.where(id: bots))
      tokens = CrewstationGitlabNative.rows(PersonalAccessToken.where(user_id: users.select(:id)), %i[name user_id expires_at revoked scopes]) do |row|
        entry(row, 'PersonalAccessToken', name: row.name, userId: row.user_id.to_s, expiresAt: row.expires_at&.iso8601,
          revoked: row.revoked, scopes: row.scopes)
      end
      missing = @token_ids - tokens.map { |row| row[:id].to_i }
      raise 'native-source-original-token-missing' unless missing.empty?
      { tokens: tokens,
        users: CrewstationGitlabNative.rows(users, %i[user_type state]) { |row| entry(row, 'User', userType: row.user_type, state: row.state) },
        memberships: CrewstationGitlabNative.rows(Member.where(user_id: users.select(:id)), %i[user_id type source_type source_id]) do |row|
          entry(row, 'Member', userId: row.user_id.to_s, type: row.type, sourceType: row.source_type, sourceId: row.source_id.to_s)
        end }
    end

    def main
      CrewstationGitlabNative.readonly(ActiveRecord::Base) do
        row = project
        raise 'native-source-pool-unsupported' if row.pool_repository_id
        raise 'native-source-shared-fork-unsupported' if row.fork_network && row.fork_network.fork_network_members.where.not(project_id: @id).exists?
        raise 'native-source-package-family-unsupported' if %i[rpm_repository_files debian_distributions npm_metadata_caches helm_metadata_caches rubygems_spec_files].any? { |name| row.public_send(name).exists? }
        raise 'native-source-storage-moves-unsupported' if row.repository_storage_moves.exists? || Snippets::RepositoryStorageMove.where(snippet_id: ProjectSnippet.where(project_id: @id).select(:id)).exists?
        categories = KINDS.to_h { |kind| [kind, []] }
        %w[repository wiki design].each { |kind| categories[kind] << entry(row, 'Project', diskPath: row.disk_path, storage: row.repository_storage) }
        categories['design'].concat(CrewstationGitlabNative.rows(DesignManagement::Repository.where(project_id: @id), [:project_id]) { |item| entry(item, 'DesignManagement::Repository', diskPath: row.disk_path + item.repo_type.path_suffix) })
        categories['snippet'] = snippets
        categories['lfs'] = CrewstationGitlabNative.rows(row.lfs_objects, %i[oid size file_store file]) do |item|
          uploaded(item, 'LfsObject', 'lfs').merge(projectIds: item.projects.reorder(:id).pluck(:id).map(&:to_s), oid: item.oid)
        end
        categories['upload'] = uploads
        categories['package'] = CrewstationGitlabNative.rows(Packages::PackageFile.where(project_id: @id), %i[project_id package_id file_name file file_store]) { |item| uploaded(item, 'Packages::PackageFile', 'package').merge(packageId: item.package_id.to_s) }
        categories['package'].concat(CrewstationGitlabNative.rows(Packages::Package.where(project_id: @id)) { |item| entry(item, 'Packages::Package') })
        categories['artifact'] = exports(row)
        repositories = row.container_repositories
        raise 'native-source-registry-storage-unsupported' if Gitlab.config.registry.enabled || repositories.exists?
        { project: { id: row.id.to_s, pathWithNamespace: row.full_path, createdAt: row.created_at.utc.iso8601(3), archived: row.archived?,
            diskPath: row.disk_path, storage: row.repository_storage, registryEnabled: false },
          roots: roots(row), categories: categories, credentials: credentials }
      end
    end

    def snippets
      native = CrewstationGitlabNative.rows(SnippetRepository.where(snippet_project_id: @id), %i[snippet_id disk_path shard_id]) do |row|
        entry(row, 'SnippetRepository', snippetId: row.snippet_id.to_s, diskPath: row.disk_path, storage: row.shard_name)
      end
      ids = native.map { |row| row[:snippetId].to_i }
      native + CrewstationGitlabNative.rows(ProjectSnippet.where(project_id: @id)) do |row|
        raise 'native-source-snippet-location-missing' unless ids.include?(row.id)
        entry(row, 'ProjectSnippet')
      end
    end

    def uploads
      CrewstationGitlabNative.rows(Upload.where(project_id: @id), %i[model_type model_id uploader path size store]) do |row|
        raise 'native-source-upload-model-unsupported' unless row.model_type == 'Project' && row.model_id == @id && row.uploader == 'FileUploader' && row.local?
        entry(row, 'Upload', path: File.join(FileUploader.root, FileUploader.base_dir(project), row.path), bytes: row.size)
      end
    end

    def exports(row)
      raise 'native-source-export-upload-unsupported' if row.import_export_uploads.exists? || row.bulk_import_exports.exists? || row.relation_export_uploads.exists?
      []
    end

    def ci
      CrewstationGitlabNative.readonly(Ci::ApplicationRecord) do
        categories = { 'artifact' => [], 'trace' => [], 'secure-file' => [] }
        categories['artifact'] = CrewstationGitlabNative.rows(Ci::JobArtifact.where(project_id: @id), %i[project_id job_id file_type file_location size file file_store]) { |row| uploaded(row, 'Ci::JobArtifact', 'artifact').merge(jobId: row.job_id.to_s, fileType: row.file_type) }
        categories['artifact'].concat(CrewstationGitlabNative.rows(Ci::PipelineArtifact.where(project_id: @id), %i[project_id pipeline_id file_type file file_store]) { |row| uploaded(row, 'Ci::PipelineArtifact', 'artifact').merge(pipelineId: row.pipeline_id.to_s) })
        categories['secure-file'] = secure_files
        categories['trace'] = CrewstationGitlabNative.rows(Ci::Build.where(project_id: @id), [:status]) { |row| entry(row, 'Ci::Build', status: row.status, path: File.join(Settings.gitlab_ci.builds_path, row.created_at.utc.strftime('%Y_%m'), @id.to_s, row.id.to_s + '.log')) }
        categories['trace'].concat(CrewstationGitlabNative.rows(Ci::BuildTraceChunk.where(build_id: Ci::Build.where(project_id: @id).select(:id)), %i[build_id data_store chunk_index]) { |row| entry(row, 'Ci::BuildTraceChunk', buildId: row.build_id.to_s, store: row.data_store, chunkIndex: row.chunk_index) })
        { categories: categories, pipelines: CrewstationGitlabNative.rows(Ci::Pipeline.where(project_id: @id), [:status]) { |row| entry(row, 'Ci::Pipeline', status: row.status) } }
      end
    end

    def secure_files
      # Instantiating SecureFile runs generate_key_data. Read only the filename
      # and use the actual uploader's location method without encryption keys.
      result = []; cursor = 0
      shadow = Struct.new(:id, :project_id, :file_store, :file, :created_at)
      loop do
        page = Ci::SecureFile.where(project_id: @id).where('id > ?', cursor).order(:id).limit(200).pluck(:id, :file_store, :file, :created_at)
        break if page.empty?
        page.each do |id, store, filename, created|
          raise 'native-source-remote-uploader-unsupported' unless store == ObjectStorage::Store::LOCAL
          raise 'native-source-budget-exceeded' if result.length >= LIMIT
          uploader = Ci::SecureFileUploader.new(shadow.new(id, @id, store, filename, created), :file)
          result << { model: 'Ci::SecureFile', id: id.to_s, createdAt: created&.utc&.iso8601(6), kind: 'secure-file', path: File.join(Ci::SecureFileUploader.root, uploader.store_path(filename)) }
        end
        cursor = page.last[0]
      end
      result
    end
  end
end

if ENV['CS_GITLAB_NATIVE_READ'] == '1'
  raw = STDIN.read(32_769)
  raise 'native-source-request-budget-exceeded' if raw.bytesize > 32_768
  input = JSON.parse(raw)
  puts 'CS_GITLAB_NATIVE=' + JSON.generate(Timeout.timeout(80) { CrewstationGitlabNative::Reader.new(input).read })
end
