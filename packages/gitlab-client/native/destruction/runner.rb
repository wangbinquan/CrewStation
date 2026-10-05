# frozen_string_literal: true

# Loaded after the original reader, fencer and detached reader by a fixed host.
# Normal GitLab destruction can rename retained repositories. No byte-proof
# flags are inferred from its acknowledgement or the detached database counts.
module CrewstationGitlabDestruction
  class Runner
    def initialize(input)
      raise 'native-source-destruction-request-invalid' unless input.keys.sort == %w[actorId request].sort
      @request = input.fetch('request')
      raise 'native-source-destruction-request-invalid' unless @request.keys.sort == %w[mode original].sort
      @mode = @request.fetch('mode')
      raise 'native-source-destruction-mode-invalid' unless %w[observe destroy purge].include?(@mode)
      @original = @request.fetch('original')
      @id = CrewstationGitlabNative.id(@original.fetch('project').fetch('id'))
      @actor = CrewstationGitlabNative.id(input.fetch('actorId'))
      raise 'native-source-version-unsupported' unless Gitlab::VERSION == CrewstationGitlabNative::VERSION
    end

    def execute
      remaining = Remaining.new(@original)
      before = remaining.read
      raise 'native-source-destruction-foreign-reference' if @mode != 'observe' && before[:foreignReferences].positive?
      destroy if @mode == 'destroy'
      purge_lfs if @mode == 'purge'
      facts = remaining.read
      runtime = CrewstationGitlabNative::Reader.new({ 'projectId' => @id.to_s,
        'pathWithNamespace' => @original.fetch('project').fetch('pathWithNamespace'),
        'createdAt' => @original.fetch('project').fetch('createdAt'), 'tokenIds' => [] }).send(:runtime)
      facts.merge(version: 1, requestDigest: CrewstationGitlabFence.digest(@request), revision: CrewstationGitlabFence.digest(facts),
        observedAt: Time.now.utc.iso8601(3), runtime: runtime,
        physicalReclamationProven: false, producersClosed: false, consumersStopped: false)
    end

    private

    # Use the same native model destruction as GitLab's unreferenced-LFS
    # worker, scoped to retained IDs and OIDs rather than global garbage.
    def purge_lfs
      raise 'native-source-destruction-actor-unauthorized' unless User.find(@actor).admin?
      raise 'native-source-destruction-parent-present' if Project.exists?(@id)
      @original.fetch('categories').flat_map { |category| category.fetch('objects') }
        .select { |row| row['model'] == 'LfsObject' }.each do |original|
        row = LfsObject.find_by(id: CrewstationGitlabNative.id(original.fetch('id')))
        next unless row
        row.with_lock do
          expected = original.fetch('createdAt')
          raise 'native-source-destruction-record-substituted' unless expected && row.created_at &&
            row.created_at == Time.iso8601(expected) && row.oid == original.fetch('oid')
          raise 'native-source-destruction-foreign-reference' unless LfsObjectsProject.where(lfs_object_id: row.id).count.zero?
          row.destroy!
        end
      end
    end

    def destroy
      actor = User.find(@actor)
      raise 'native-source-destruction-actor-unauthorized' unless actor.admin?
      return unless Project.exists?(@id) # Original absent: independently inspect, never resolve a replacement by path.
      project = @original.fetch('project').reject { |key, _value| %w[archived registryEnabled].include?(key) }
      fencer = CrewstationGitlabFence::Fencer.new({ 'actorId' => @actor.to_s,
        'request' => { 'project' => project, 'credentials' => @original.fetch('credentials') } })
      row = fencer.send(:original_project)
      row.with_lock do
        row = fencer.send(:original_project)
        raise 'native-source-destruction-actor-unauthorized' unless Ability.allowed?(actor, :remove_project, row)
        current = fencer.send(:credentials)
        fencer.send(:assert_credentials, current)
        raise 'native-source-destruction-not-fenced' unless row.pending_delete? && row.deletion_in_progress? &&
          current[:tokens].all? { |token| token[:revoked] } && current[:users].all? { |user| user[:state] == 'blocked' } &&
          Ci::Pipeline.where(project_id: @id).cancelable.count.zero?
        raise 'native-source-destruction-native-failed' unless Projects::DestroyService.new(row, actor).execute == true
      end
    end
  end
end

if ENV['CS_GITLAB_NATIVE_DESTRUCTION'] == '1'
  raw = STDIN.read(8_388_609)
  raise 'native-source-destruction-request-budget' if raw.bytesize > 8_388_608
  encoded = Timeout.timeout(80) { JSON.generate(CrewstationGitlabDestruction::Runner.new(JSON.parse(raw)).execute) }
  raise 'native-source-destruction-output-budget' if encoded.bytesize + 22 > 8_388_608
  puts 'CS_GITLAB_DESTRUCTION=' + encoded
end
