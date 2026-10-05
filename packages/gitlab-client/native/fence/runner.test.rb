# frozen_string_literal: true

# Standalone control-flow tests. They never load Rails, open its databases, or
# create/mutate a native GitLab project. Live metadata validation is separate.
require 'json'
require 'digest'
require 'time'
require 'timeout'

module CrewstationGitlabFenceTest
  class << self
    attr_accessor :input, :current, :actions, :project, :pipeline_count, :deny, :reads, :replace_on_read, :pipeline_error
  end
  def self.reset
    self.actions = []; self.reads = 0; self.replace_on_read = nil; self.deny = false; self.pipeline_error = false
    birth = '2026-09-30T16:00:35.872000Z'
    credentials = { tokens: [{ model: 'PersonalAccessToken', id: '513', createdAt: birth, userId: '541', name: 'owned', revoked: false, scopes: ['api'], expiresAt: nil }],
      users: [{ model: 'User', id: '541', createdAt: birth, userType: 'project_bot', state: 'active' }],
      memberships: [{ model: 'Member', id: '700', createdAt: birth, userId: '541', type: 'ProjectMember', sourceType: 'Project', sourceId: '383' }] }
    self.current = JSON.parse(JSON.generate(credentials), symbolize_names: true)
    self.input = { 'actorId' => '1', 'request' => { 'project' => { 'id' => '383', 'createdAt' => '2026-09-30T16:00:35.872Z',
      'pathWithNamespace' => 'group/original', 'diskPath' => '@hashed/original', 'storage' => 'default' }, 'credentials' => JSON.parse(JSON.generate(credentials)) } }
    self.project = Project.new; self.pipeline_count = 3
  end
  def self.assert(value, message)
    raise message unless value
  end
  def self.rejects(pattern)
    begin
      yield
    rescue StandardError => error
      assert(error.message.match?(pattern), 'unexpected rejection: ' + error.message)
      return
    end
    raise 'unsafe native fence accepted'
  end
  class Relation
    def initialize(items)
      @items = items
    end
    def lock; self; end
    def reorder(_key); self; end
    def select(*_fields); self; end
    def to_a; @items; end
    def map(&block); @items.map(&block); end
  end
end

module CrewstationGitlabNative
  def self.canonical(value)
    case value
    when Hash then value.keys.sort_by(&:to_s).to_h { |key| [key.to_s, canonical(value[key])] }
    when Array then value.map { |row| canonical(row) }
    else value
    end
  end
  def self.id(value)
    raise 'native-source-invalid-id' unless value.to_s.match?(/\A[1-9][0-9]*\z/)
    value.to_i
  end
  class Reader
    def initialize(_request); end
    def credentials
      f = CrewstationGitlabFenceTest; f.reads += 1
      f.current[:tokens][0][:createdAt] = '2026-10-01T00:00:00Z' if f.reads == f.replace_on_read
      JSON.parse(JSON.generate(f.current), symbolize_names: true)
    end
    def runtime
      { bootId: '73fa6bd2-3c64-4d61-8ab3-fa4ff0cc372a', namespace: 'pid:[17]', readerPid: Process.pid, readerStartedTick: '999' }
    end
  end
end
class Project
  attr_accessor :full_path, :created_at, :disk_path, :repository_storage, :pending, :deleting
  def initialize
    @full_path = 'group/original'; @created_at = Time.iso8601('2026-09-30T16:00:35.872Z')
    @disk_path = '@hashed/original'; @repository_storage = 'default'; @pending = false; @deleting = false
  end
  def self.find(id)
    raise 'project not found' unless id == 383
    CrewstationGitlabFenceTest.project
  end
  def with_lock
    CrewstationGitlabFenceTest.actions << 'lock'; yield
  end
  def pending_delete?; @pending; end
  def deletion_in_progress?; @deleting; end
end
class User
  attr_reader :id
  def initialize(id); @id = id.to_i; end
  def self.find(id); new(id); end
  def self.where(id:)
    CrewstationGitlabFenceTest::Relation.new(id.map { |value| new(value) })
  end
  def admin?; @id == 1; end
  def blocked?; CrewstationGitlabFenceTest.current[:users].find { |user| user[:id] == @id.to_s }&.fetch(:state) == 'blocked'; end
end
class PersonalAccessToken
  def initialize(id); @id = id; end
  def self.where(id:)
    CrewstationGitlabFenceTest::Relation.new(id.map { |value| new(value) })
  end
  def revoke!
    CrewstationGitlabFenceTest.current[:tokens].find { |token| token[:id] == @id }[:revoked] = true
    CrewstationGitlabFenceTest.actions << 'revoke'; true
  end
end
module Ability
  def self.allowed?(actor, permission, _project)
    return !CrewstationGitlabFenceTest.deny if permission == :remove_project
    actor.id == 1 && %i[admin_secure_files create_resource_access_tokens].include?(permission)
  end
end
module Projects
  class DestroyService
    def initialize(project, _actor); @project = project; end
    def mark_deletion_in_progress
      @project.pending = true; @project.deleting = true; CrewstationGitlabFenceTest.actions << 'mark'
    end
  end
end
module Users
  class BlockService
    def initialize(_actor); end
    def execute(user)
      CrewstationGitlabFenceTest.current[:users].find { |row| row[:id] == user.id.to_s }[:state] = 'blocked'
      CrewstationGitlabFenceTest.actions << 'block'; { status: :success }
    end
  end
end
module Ci
  class Pipeline
    def self.where(project_id:)
      raise 'foreign pipelines' unless project_id == 383
      new
    end
    def cancelable; self; end
    def count; CrewstationGitlabFenceTest.pipeline_count; end
  end
  class AbortPipelinesService
    def execute(_pipelines, reason)
      raise 'wrong abort reason' unless reason == :project_deleted
      CrewstationGitlabFenceTest.pipeline_count = 0; CrewstationGitlabFenceTest.actions << 'abort'
      Struct.new(:error?).new(CrewstationGitlabFenceTest.pipeline_error)
    end
  end
end

require_relative 'runner'
f = CrewstationGitlabFenceTest
f.reset
receipt = CrewstationGitlabFence::Fencer.new(f.input).execute
f.assert(f.actions == %w[lock mark revoke block abort], 'native ordering differs')
f.assert(receipt[:credentials][:tokens].all? { |row| row[:revoked] } && receipt[:credentials][:users].all? { |row| row[:state] == 'blocked' }, 'owned credentials stayed usable')
f.assert(receipt[:pendingDelete] && receipt[:deletionInProgress] && receipt[:cancelablePipelines].zero?, 'native state not checked')
f.assert(receipt[:permissions].find { |row| row[:userId] == '1' }[:allowed].include?('admin_secure_files') && !receipt[:producersClosed] && !receipt[:consumersStopped] && !receipt[:physicalReclamationProven], 'native acknowledgement became full cleanup proof')
f.actions.clear
CrewstationGitlabFence::Fencer.new(f.input).execute
f.assert(!f.actions.include?('block'), 'already blocked bot was blocked twice')
%w[full_path created_at disk_path repository_storage].each do |field|
  f.reset
  f.project.public_send(field + '=', field == 'created_at' ? Time.iso8601('2026-10-01T00:00:00Z') : 'foreign')
  f.rejects(/repository-substituted/) { CrewstationGitlabFence::Fencer.new(f.input).execute }
  f.assert(f.actions.empty?, 'substituted repository mutated')
end
f.reset; f.current[:memberships][0][:sourceId] = '384'
f.rejects(/shared-user/) { CrewstationGitlabFence::Fencer.new(f.input).execute }
f.assert(f.actions == ['lock'], 'foreign member revoked')
f.reset; f.replace_on_read = 2
f.rejects(/original-credentials-changed/) { CrewstationGitlabFence::Fencer.new(f.input).execute }
f.assert(f.actions == ['lock'], 'replacement after lock mutated')
f.reset; f.deny = true
f.rejects(/actor-unauthorized/) { CrewstationGitlabFence::Fencer.new(f.input).execute }
f.assert(f.actions.empty?, 'denied actor mutated')
f.reset; f.pipeline_error = true
f.rejects(/pipeline-stop-failed/) { CrewstationGitlabFence::Fencer.new(f.input).execute }
puts JSON.generate({ nativeControlFlowCases: 10, nativeDatabasesOpened: false, originalProjectTouched: false })
