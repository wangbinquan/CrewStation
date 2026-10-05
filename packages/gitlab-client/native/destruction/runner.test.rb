# frozen_string_literal: true

require 'json'
require 'digest'
require 'time'
require 'ostruct'

module CrewstationGitlabNative
  VERSION = '19.2.4'
  KINDS = %w[repository wiki design snippet lfs upload artifact trace package registry secure-file].freeze
  def self.id(value)
    Integer(value)
  end
  def self.readonly(base)
    $transactions << base.name
    yield
  end
  def self.canonical(value)
    return value.keys.sort_by(&:to_s).to_h { |key| [key.to_s, canonical(value[key])] } if value.is_a?(Hash)
    return value.map { |item| canonical(item) } if value.is_a?(Array)
    value
  end
  def self.rows(*)
    raise('model-instantiation-forbidden')
  end
  class Reader
    def initialize(*)
      nil
    end
    def runtime
      { bootId: '73fa6bd2-3c64-4d61-8ab3-fa4ff0cc372a', namespace: 'pid:[17]', readerPid: 42, readerStartedTick: '999' }
    end
  end
end
class Relation
  def initialize(model, rows, field = :id)
    @model, @rows, @field = model, rows, field
  end
  def count
    @rows.length
  end
  def select(field)
    Relation.new(@model, @rows, field)
  end
  def ids
    @rows.map { |row| row[@field] }
  end
  def pluck(*fields)
    @rows.map { |row| fields.map { |field| row[field.to_sym] } }
  end
  def where(values = nil)
    return self if values.nil?
    Relation.new(@model, @rows.select { |row| matches?(row, values) })
  end
  def not(**values)
    Relation.new(@model, @rows.reject { |row| matches?(row, values) })
  end
  def or(other)
    Relation.new(@model, (@rows + other.instance_variable_get(:@rows)).uniq { |row| [row[:id], row[:partition_id]] })
  end
  private
  def matches?(row, values)
    values.all? do |key, expected|
      list = expected.is_a?(Relation) ? expected.ids : expected.is_a?(Array) ? expected : [expected]
      list.any? { |value| row[key].to_s == value.to_s }
    end
  end
end
class Model
  class << self
    attr_accessor :data
    def select(*)
      self
    end
    def where(values = nil)
      Relation.new(self, data).where(values)
    end
    def column_names
      %w[id created_at partition_id]
    end
    def exists?(id)
      data.any? { |row| row[:id].to_s == id.to_s }
    end
    def find_by(**values)
      row = data.find { |item| values.all? { |key, value| item[key].to_s == value.to_s } }
      row && OpenStruct.new(row)
    end
    def find(id)
      find_by(id: id) || raise('not-found')
    end
  end
end
class Project < Model; end
class PersonalAccessToken < Model; end
class User < Model; end
class Member < Model; end
class SnippetRepository < Model; end
class ProjectSnippet < Model; end
class LfsObject < Model; end
class LfsObjectsProject < Model; end
class Upload < Model; end
class ContainerRepository < Model; end
module DesignManagement; class Repository < Model; end; end
module Packages; class Package < Model; end; class PackageFile < Model; end; end
module ActiveRecord; class Base; end; end
module Ci
  class ApplicationRecord; end
  class JobArtifact < Model; end
  class PipelineArtifact < Model; end
  class SecureFile < Model; end
  class Build < Model; end
  class BuildTraceChunk < Model; end
  class Pipeline < Model
    def self.where(values = nil)
      value = super
      value.define_singleton_method(:cancelable) { define_singleton_method(:count) { $cancelable }; self }
      value
    end
  end
end
module Gitlab
  VERSION = '19.2.4'
  def self.config
    OpenStruct.new(registry: OpenStruct.new(enabled: $registry))
  end
end
module Ability
  def self.allowed?(*)
    $authorized
  end
end
module CrewstationGitlabFence
  def self.digest(value)
    Digest::SHA256.hexdigest(JSON.generate(CrewstationGitlabNative.canonical(value)))
  end
  class Fencer
    def initialize(*)
      nil
    end
    def original_project
      row = OpenStruct.new(pending_delete?: $fenced, deletion_in_progress?: $fenced)
      row.define_singleton_method(:with_lock) do |&block|
        $locked = true
        begin
          block.call
        ensure
          $locked = false
        end
      end
      row
    end
    def credentials
      { tokens: [{ revoked: $fenced }], users: [{ state: $fenced ? 'blocked' : 'active' }] }
    end
    def assert_credentials(*)
      raise('native-source-fence-original-credentials-changed') if $credentials_changed
    end
  end
end
module Projects
  class DestroyService
    def initialize(*)
      nil
    end
    def execute
      raise 'native-source-destruction-not-locked' unless $locked
      $mutations += 1
      return false if $native_failed
      $models.each { |model| model.data.reject! { |row| row[:id] != 1 } }
      true
    end
  end
end
load File.join(__dir__, 'remaining.rb')
load File.join(__dir__, 'runner.rb')
def assert(value)
  raise('assertion-failed') unless value
end
def rejects(prefix)
  begin
    yield
  rescue StandardError => error
    raise unless error.message.include?(prefix)
    return
  end
  raise 'expected-rejection'
end
def fixture
  born = Time.iso8601('2026-09-30T16:00:35.872Z')
  $registry = false; $fenced = true; $authorized = true; $credentials_changed = false
  $native_failed = false; $mutations = 0; $cancelable = 0; $transactions = []
  $models = [Project, PersonalAccessToken, User, Member, SnippetRepository, ProjectSnippet, LfsObject, LfsObjectsProject,
    Upload, ContainerRepository, DesignManagement::Repository, Packages::Package, Packages::PackageFile,
    Ci::JobArtifact, Ci::PipelineArtifact, Ci::SecureFile, Ci::Build, Ci::BuildTraceChunk, Ci::Pipeline]
  $models.each { |model| model.data = [] }
  project = { 'id' => '383', 'pathWithNamespace' => 'group/original', 'createdAt' => born.iso8601(3),
    'diskPath' => '@hashed/original', 'storage' => 'default', 'archived' => false, 'registryEnabled' => false }
  Project.data = [{ id: 383, created_at: born, full_path: 'group/original', disk_path: '@hashed/original', repository_storage: 'default' }]
  User.data = [{ id: 1, created_at: born, admin?: true }, { id: 52, created_at: born }]
  PersonalAccessToken.data = [{ id: 51, created_at: born }]; Member.data = [{ id: 53, created_at: born, user_id: 52, source_id: 383, source_type: 'Project' }]
  categories = CrewstationGitlabNative::KINDS.to_h { |kind| [kind, []] }
  [[DesignManagement::Repository, 'design', 31], [SnippetRepository, 'snippet', 32], [ProjectSnippet, 'snippet', 33],
    [LfsObject, 'lfs', 34], [Upload, 'upload', 37], [Packages::PackageFile, 'package', 38], [Packages::Package, 'package', 39],
    [Ci::JobArtifact, 'artifact', 40], [Ci::PipelineArtifact, 'artifact', 41], [Ci::SecureFile, 'secure-file', 42],
    [Ci::Build, 'trace', 43], [Ci::BuildTraceChunk, 'trace', 44]].each do |model, kind, id|
    model.data = [{ id: id, created_at: born, project_id: 383, snippet_project_id: 383, build_id: 43 }]
    model.data[0][:oid] = 'a' * 64 if model == LfsObject
    categories[kind] << { 'id' => id.to_s, 'createdAt' => born.iso8601(6), 'model' => model.name }
    categories[kind][-1]['oid'] = 'a' * 64 if model == LfsObject
  end
  LfsObjectsProject.data = [{ id: 35, lfs_object_id: 34, project_id: 383 }]
  Ci::Pipeline.data = [{ id: 45, created_at: born, project_id: 383 }]
  credentials = { 'tokens' => [{ 'id' => '51', 'createdAt' => born.iso8601(6) }],
    'users' => [{ 'id' => '52', 'createdAt' => born.iso8601(6) }], 'memberships' => [{ 'id' => '53', 'createdAt' => born.iso8601(6) }] }
  original = { 'project' => project, 'credentials' => credentials,
    'categories' => categories.map { |kind, objects| { 'kind' => kind, 'objects' => objects } },
    'pipelines' => [{ 'id' => '45', 'createdAt' => born.iso8601(6) }] }
  { 'actorId' => '1', 'request' => { 'mode' => 'destroy', 'original' => original } }
end
cases = 0
input = fixture; input['request']['mode'] = 'observe'
value = CrewstationGitlabDestruction::Runner.new(input).execute
assert(value[:parentRemaining] == 1 && value[:credentialsRemaining] == 3 && value[:nativeRemaining] == 17 && $mutations.zero?)
assert($transactions.first(4) == ['ActiveRecord::Base', 'Ci::ApplicationRecord', 'Ci::ApplicationRecord', 'ActiveRecord::Base']); cases += 1
input = fixture; Project.data = []
value = CrewstationGitlabDestruction::Runner.new(input).execute
assert(value[:parentRemaining].zero? && value[:categories].sum { |row| row[:count] } == 12 && value[:nativeRemaining] == 16 && $mutations.zero?); cases += 1
input = fixture; value = CrewstationGitlabDestruction::Runner.new(input).execute
assert($mutations == 1 && value[:nativeRemaining].zero? && !value[:physicalReclamationProven] && !value[:consumersStopped])
assert(CrewstationGitlabDestruction::Runner.new(input).execute[:nativeRemaining].zero? && $mutations == 1); cases += 1
%i[full_path created_at disk_path repository_storage].each do |field|
  input = fixture; Project.data[0][field] = field == :created_at ? Time.now : 'replacement'
  rejects('parent-substituted') { CrewstationGitlabDestruction::Runner.new(input).execute }; assert($mutations.zero?)
end; cases += 1
input = fixture; Ci::SecureFile.data[0][:created_at] = Time.now
rejects('record-substituted') { CrewstationGitlabDestruction::Runner.new(input).execute }; assert($mutations.zero?); cases += 1
input = fixture; LfsObjectsProject.data << { id: 36, lfs_object_id: 34, project_id: 999 }
rejects('foreign-reference') { CrewstationGitlabDestruction::Runner.new(input).execute }; assert($mutations.zero?)
input['request']['mode'] = 'observe'; assert(CrewstationGitlabDestruction::Runner.new(input).execute[:foreignReferences] == 1); cases += 1
input = fixture; Member.data << { id: 99, user_id: 52, source_id: 999, source_type: 'Project' }
rejects('foreign-reference') { CrewstationGitlabDestruction::Runner.new(input).execute }; assert($mutations.zero?); cases += 1
%w[unfenced active-pipeline credential-change].each do |mode|
  input = fixture; $fenced = false if mode == 'unfenced'; $cancelable = 1 if mode == 'active-pipeline'; $credentials_changed = true if mode == 'credential-change'
  rejects('native-source-') { CrewstationGitlabDestruction::Runner.new(input).execute }; assert($mutations.zero?)
end; cases += 1
input = fixture; $authorized = false
rejects('actor-unauthorized') { CrewstationGitlabDestruction::Runner.new(input).execute }; assert($mutations.zero?); cases += 1
input = fixture; $native_failed = true
rejects('native-failed') { CrewstationGitlabDestruction::Runner.new(input).execute }; assert($mutations == 1 && Project.exists?(383)); cases += 1
input = fixture; Ci::BuildTraceChunk.data[0][:build_id] = 999; Project.data = []; Ci::Build.data = []
input['request']['mode'] = 'observe'; value = CrewstationGitlabDestruction::Runner.new(input).execute
assert(value[:categories].find { |row| row[:kind] == 'trace' }[:count] == 1); cases += 1
input = fixture; $registry = true
rejects('registry-unsupported') { CrewstationGitlabDestruction::Runner.new(input).execute }; assert($mutations.zero?); cases += 1
input = fixture; Project.data = []; Ci::Build.data = []; Ci::BuildTraceChunk.data[0][:created_at] = nil
input['request']['original']['categories'].find { |row| row['kind'] == 'trace' }['objects'].find { |row| row['model'] == 'Ci::BuildTraceChunk' }['createdAt'] = nil
input['request']['mode'] = 'observe'; value = CrewstationGitlabDestruction::Runner.new(input).execute
assert(value[:categories].find { |row| row[:kind] == 'trace' }[:count] == 1 && $mutations.zero?); cases += 1
input = fixture; Project.data = []; Ci::Build.data = []; Ci::Pipeline.data = []; Ci::BuildTraceChunk.data = []
Ci::BuildTraceChunk.data << { id: 98, build_id: 43, created_at: nil }
Ci::JobArtifact.data << { id: 99, job_id: 43, project_id: nil, created_at: Time.now }
Ci::PipelineArtifact.data << { id: 100, pipeline_id: 45, project_id: nil, created_at: Time.now }
PersonalAccessToken.data << { id: 101, user_id: 52, created_at: Time.now }
input['request']['mode'] = 'observe'; value = CrewstationGitlabDestruction::Runner.new(input).execute
assert(value[:credentialsRemaining] == 4 && value[:categories].find { |row| row[:kind] == 'trace' }[:count] == 1 &&
  value[:categories].find { |row| row[:kind] == 'artifact' }[:count] == 4 && $mutations.zero?); cases += 1
# A deduplicated OID can be re-created under a new native ID. Original IDs alone
# must never certify its bytes as exclusively owned and absent.
input = fixture; Project.data = []; LfsObject.data = [{ id: 999, oid: 'a' * 64, created_at: Time.now }]
LfsObjectsProject.data = [{ id: 998, lfs_object_id: 999, project_id: 999 }]; input['request']['mode'] = 'observe'
rejects('record-substituted') { CrewstationGitlabDestruction::Runner.new(input).execute }; assert($mutations.zero?); cases += 1
input = fixture; Project.data = []; LfsObjectsProject.data = []; input['request']['mode'] = 'purge'
original_find = LfsObject.method(:find_by)
LfsObject.define_singleton_method(:find_by) do |**values|
  row = original_find.call(**values)
  if row
    row.define_singleton_method(:with_lock) { |&block| block.call }
    row.define_singleton_method(:destroy!) { LfsObject.data.reject! { |value| value[:id] == id }; $mutations += 1 }
  end
  row
end
value = CrewstationGitlabDestruction::Runner.new(input).execute
assert(value[:categories].find { |row| row[:kind] == 'lfs' }[:count].zero? && $mutations == 1)
CrewstationGitlabDestruction::Runner.new(input).execute; assert($mutations == 1); cases += 1
input = fixture; input['request']['mode'] = 'purge'
rejects('parent-present') { CrewstationGitlabDestruction::Runner.new(input).execute }; assert($mutations.zero?); cases += 1
input = fixture; Project.data = []; input['request']['mode'] = 'purge'
LfsObjectsProject.data << { id: 36, lfs_object_id: 34, project_id: 999 }
rejects('foreign-reference') { CrewstationGitlabDestruction::Runner.new(input).execute }; assert($mutations.zero?); cases += 1
puts JSON.generate({ nativeDestructionCases: cases, nativeDatabasesOpened: false, originalProjectTouched: false })
