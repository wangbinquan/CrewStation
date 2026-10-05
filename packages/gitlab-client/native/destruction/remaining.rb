# frozen_string_literal: true

# Detached reads never resolve Project to find its former children. This reader
# remains usable after the parent and its associations have been destroyed.
module CrewstationGitlabDestruction
  class Remaining
    def initialize(original)
      @original = original
      @id = CrewstationGitlabNative.id(original.fetch('project').fetch('id'))
      @objects = original.fetch('categories').flat_map { |row| row.fetch('objects') }
    end

    def read
      before = main
      ci_before = ci
      ci_after = ci
      after = main
      raise 'native-source-destruction-metadata-changed' unless before == after && ci_before == ci_after
      categories = CrewstationGitlabNative::KINDS.map do |kind|
        { kind: kind, count: before[:categories].fetch(kind, 0) + ci_before[:categories].fetch(kind, 0), complete: true }
      end
      facts = { project: @original.fetch('project'), parentRemaining: before[:parent], credentialsRemaining: before[:credentials],
        pipelinesRemaining: ci_before[:pipelines], foreignReferences: before[:foreign], categories: categories }
      facts[:nativeRemaining] = facts[:parentRemaining] + facts[:credentialsRemaining] + facts[:pipelinesRemaining] + categories.sum { |row| row[:count] }
      facts
    end

    private

    def original_rows(name)
      @objects.select { |row| row['model'] == name }.uniq { |row| [row['id'], row['partitionId']] }
    end

    def relation(model, name, owned)
      originals = original_rows(name)
      check_births(model, originals)
      # Keep captured IDs in the query even after project_id links disappear.
      owned.or(model.where(id: originals.map { |row| row.fetch('id') }))
    end

    def check_births(model, originals)
      return if originals.empty?
      fields = %w[id created_at partition_id].select { |field| model.column_names.include?(field) }
      originals.each_slice(200) do |batch|
        # pluck avoids SecureFile's after_initialize encryption-key mutation.
        model.where(id: batch.map { |row| row.fetch('id') }).pluck(*fields).each do |values|
          birth = fields.zip(values).to_h
          expected = batch.find { |entry| entry['id'] == birth['id'].to_s && entry['partitionId'] == birth['partition_id']&.to_s }
          # Native tables without created_at still count as remaining. No child
          # row is deleted by captured ID; DestroyService follows the verified
          # original parent. A surviving unknown-birth row never counts as zero.
          same_birth = expected && (expected['createdAt'].nil? ? birth['created_at'].nil? :
            birth['created_at'] && Time.iso8601(expected['createdAt']) == birth['created_at'])
          raise 'native-source-destruction-record-substituted' unless same_birth
        end
      end
    end

    def parent
      row = Project.select(:id, :created_at, :path, :namespace_id, :repository_storage, :storage_version).find_by(id: @id)
      return 0 unless row
      expected = @original.fetch('project')
      raise 'native-source-destruction-parent-substituted' unless row.full_path == expected['pathWithNamespace'] &&
        row.created_at.utc.iso8601(3) == Time.iso8601(expected['createdAt']).utc.iso8601(3) &&
        row.disk_path == expected['diskPath'] && row.repository_storage == expected['storage']
      1
    end

    def credentials
      originals = @original.fetch('credentials')
      models = { 'tokens' => PersonalAccessToken, 'users' => User, 'memberships' => Member }
      users = originals.fetch('users').map { |row| row.fetch('id') }
      models.sum do |key, model|
        check_births(model, originals.fetch(key))
        retained = model.where(id: originals.fetch(key).map { |row| row.fetch('id') })
        retained = retained.or(model.where(user_id: users)) unless key == 'users'
        retained.count
      end
    end

    def lfs
      originals = original_rows('LfsObject')
      objects = relation(LfsObject, 'LfsObject', LfsObject.where(id: LfsObjectsProject.where(project_id: @id).select(:lfs_object_id)))
        .or(LfsObject.where(oid: originals.map { |row| row.fetch('oid') }))
      objects.pluck(:id, :oid).each do |id, oid|
        expected = originals.find { |row| row['oid'] == oid }
        raise 'native-source-destruction-record-substituted' if expected && expected['id'] != id.to_s
      end
      objects
    end

    def main
      CrewstationGitlabNative.readonly(ActiveRecord::Base) do
        raise 'native-source-destruction-registry-unsupported' if Gitlab.config.registry.enabled
        lfs_objects = lfs
        users = @original.fetch('credentials').fetch('users').map { |row| row.fetch('id') }
        foreign = LfsObjectsProject.where(lfs_object_id: lfs_objects.select(:id)).where.not(project_id: @id).count +
          Member.where(user_id: users).where.not(source_id: @id, source_type: 'Project').count
        categories = { 'repository' => 0, 'wiki' => 0,
          'design' => relation(DesignManagement::Repository, 'DesignManagement::Repository', DesignManagement::Repository.where(project_id: @id)).count,
          'snippet' => relation(SnippetRepository, 'SnippetRepository', SnippetRepository.where(snippet_project_id: @id)).count +
            relation(ProjectSnippet, 'ProjectSnippet', ProjectSnippet.where(project_id: @id)).count,
          'lfs' => lfs_objects.count, 'upload' => relation(Upload, 'Upload', Upload.where(project_id: @id)).count,
          'package' => relation(Packages::PackageFile, 'Packages::PackageFile', Packages::PackageFile.where(project_id: @id)).count +
            relation(Packages::Package, 'Packages::Package', Packages::Package.where(project_id: @id)).count,
          'registry' => ContainerRepository.where(project_id: @id).count }
        { parent: parent, credentials: credentials, foreign: foreign, categories: categories }
      end
    end

    def ci
      CrewstationGitlabNative.readonly(Ci::ApplicationRecord) do
        builds = relation(Ci::Build, 'Ci::Build', Ci::Build.where(project_id: @id))
        original_builds = original_rows('Ci::Build').map { |row| row.fetch('id') }
        original_pipelines = @original.fetch('pipelines').map { |row| row.fetch('id') }
        categories = {
          'artifact' => relation(Ci::JobArtifact, 'Ci::JobArtifact', Ci::JobArtifact.where(project_id: @id).or(Ci::JobArtifact.where(job_id: original_builds))).count +
            relation(Ci::PipelineArtifact, 'Ci::PipelineArtifact', Ci::PipelineArtifact.where(project_id: @id).or(Ci::PipelineArtifact.where(pipeline_id: original_pipelines))).count,
          'trace' => builds.count + relation(Ci::BuildTraceChunk, 'Ci::BuildTraceChunk', Ci::BuildTraceChunk.where(build_id: builds.select(:id))
            .or(Ci::BuildTraceChunk.where(build_id: original_builds))).count,
          'secure-file' => relation(Ci::SecureFile, 'Ci::SecureFile', Ci::SecureFile.where(project_id: @id)).count }
        originals = @original.fetch('pipelines')
        check_births(Ci::Pipeline, originals)
        { categories: categories, pipelines: Ci::Pipeline.where(project_id: @id).or(Ci::Pipeline.where(id: originals.map { |row| row.fetch('id') })).count }
      end
    end
  end
end
