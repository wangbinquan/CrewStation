# frozen_string_literal: true

# Loaded after the native reader by the fixed original host adapter. Native
# state changes are deliberately separate from independent consumer/byte proof.
module CrewstationGitlabFence
  PERMISSIONS = %w[push_code create_wiki create_design create_snippet upload_file create_build create_pipeline create_package
                   create_container_image admin_secure_files create_resource_access_tokens].freeze

  def self.digest(value)
    Digest::SHA256.hexdigest(JSON.generate(CrewstationGitlabNative.canonical(value)))
  end

  def self.origins(credentials)
    order = ->(rows) { rows.sort_by { |row| digest(row) } }
    { tokens: order.call(credentials.fetch(:tokens).map { |row| row.reject { |key, _value| key == :revoked } }),
      users: order.call(credentials.fetch(:users).map { |row| row.reject { |key, _value| key == :state } }),
      memberships: order.call(credentials.fetch(:memberships)) }
  end

  class Fencer
    def initialize(input)
      raise 'native-source-fence-request-invalid' unless input.is_a?(Hash) && input.keys.sort == %w[actorId request].sort
      @request = input.fetch('request')
      raise 'native-source-fence-request-invalid' unless @request.keys.sort == %w[credentials project].sort
      @expected = @request.fetch('project')
      raise 'native-source-fence-project-invalid' unless @expected.keys.sort == %w[createdAt diskPath id pathWithNamespace storage].sort
      @id = CrewstationGitlabNative.id(@expected.fetch('id'))
      raise 'native-source-fence-birth-required' unless @expected['createdAt'].is_a?(String)
      @actor_id = CrewstationGitlabNative.id(input.fetch('actorId'))
      @credentials = JSON.parse(JSON.generate(@request.fetch('credentials')), symbolize_names: true)
      raise 'native-source-fence-credentials-invalid' unless @credentials.keys.sort == %i[memberships tokens users].sort
      @reader = CrewstationGitlabNative::Reader.new({ 'projectId' => @id.to_s, 'pathWithNamespace' => @expected.fetch('pathWithNamespace'),
        'createdAt' => @expected.fetch('createdAt'), 'tokenIds' => @credentials.fetch(:tokens).map { |row| row.fetch(:id) } })
    end

    def execute
      # Resolve and authorize the configured service actor, never an HTTP-supplied identity.
      actor = User.find(@actor_id)
      project = original_project
      raise 'native-source-fence-actor-unauthorized' unless actor.admin? && Ability.allowed?(actor, :remove_project, project)
      project.with_lock do
        original_project
        current = credentials
        assert_credentials(current)
        users = User.where(id: current[:users].map { |row| row[:id] }).lock.reorder(:id).to_a
        tokens = PersonalAccessToken.where(id: current[:tokens].map { |row| row[:id] }).select(:id, :revoked).lock.reorder(:id).to_a
        # Lock first and re-read ownership before the first mutation. No shared or
        # substituted bot/token may be revoked or blocked as part of this project.
        assert_credentials(credentials)
        Projects::DestroyService.new(project, actor).send(:mark_deletion_in_progress)
        tokens.each { |token| raise 'native-source-fence-token-revoke-failed' unless token.revoke! }
        users.each do |user|
          next if user.blocked?
          result = Users::BlockService.new(actor).execute(user)
          raise 'native-source-fence-bot-block-failed' unless result[:status] == :success
        end
      end
      result = Ci::AbortPipelinesService.new.execute(Ci::Pipeline.where(project_id: @id), :project_deleted)
      raise 'native-source-fence-pipeline-stop-failed' if result.error?
      project = original_project
      current = credentials
      assert_credentials(current)
      users = User.where(id: (@credentials[:users].map { |row| row[:id] } + [@actor_id])).reorder(:id)
      facts = { project: @expected, pendingDelete: project.pending_delete?, deletionInProgress: project.deletion_in_progress?,
        credentials: current, cancelablePipelines: Ci::Pipeline.where(project_id: @id).cancelable.count,
        permissions: users.map { |user| { userId: user.id.to_s, allowed: PERMISSIONS.select { |permission| Ability.allowed?(user, permission.to_sym, project) } } } }
      facts.merge(version: 1, requestDigest: CrewstationGitlabFence.digest(@request), revision: CrewstationGitlabFence.digest(facts),
        observedAt: Time.now.utc.iso8601(3), runtime: @reader.send(:runtime),
        physicalReclamationProven: false, producersClosed: false, consumersStopped: false)
    end

    private

    def original_project
      row = Project.find(@id)
      raise 'native-source-fence-repository-substituted' unless row.full_path == @expected['pathWithNamespace'] &&
        row.created_at.utc.iso8601(3) == Time.iso8601(@expected['createdAt']).utc.iso8601(3) &&
        row.disk_path == @expected['diskPath'] && row.repository_storage == @expected['storage']
      row
    end

    def credentials
      @reader.send(:credentials)
    end

    def assert_credentials(current)
      raise 'native-source-fence-identity-missing' unless (current[:tokens] + current[:users] + current[:memberships]).all? { |row| row[:createdAt] }
      users = current[:users].map { |row| row[:id] }
      raise 'native-source-fence-shared-user' unless current[:users].all? { |row| row[:userType] == 'project_bot' } &&
        current[:tokens].all? { |row| users.include?(row[:userId]) } &&
        current[:memberships].all? { |row| row[:type] == 'ProjectMember' && row[:sourceType] == 'Project' && row[:sourceId] == @id.to_s && users.include?(row[:userId]) } &&
        users.all? { |id| current[:memberships].any? { |row| row[:userId] == id } }
      raise 'native-source-fence-original-credentials-changed' unless CrewstationGitlabFence.origins(current) == CrewstationGitlabFence.origins(@credentials)
    end
  end
end

if ENV['CS_GITLAB_NATIVE_FENCE'] == '1'
  raw = STDIN.read(8_388_609)
  raise 'native-source-fence-request-budget' if raw.bytesize > 8_388_608
  encoded = Timeout.timeout(80) { JSON.generate(CrewstationGitlabFence::Fencer.new(JSON.parse(raw)).execute) }
  raise 'native-source-fence-output-budget' if encoded.bytesize + 16 > 8_388_608
  puts 'CS_GITLAB_FENCE=' + encoded
end
