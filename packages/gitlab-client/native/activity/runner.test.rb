# frozen_string_literal: true

require 'json'
require 'digest'
require 'time'
require 'ostruct'
require 'set'
# This fixture needs no Redis or Rails. The production source still requires the
# original Sidekiq API, and no fixture source is sent to a real project.
$LOADED_FEATURES << 'sidekiq/api.rb'
module Gitlab; VERSION = '19.2.4'; end
module CrewstationGitlabNative
  VERSION = '19.2.4'
  def self.id(value)
    Integer(value)
  end
  def self.canonical(value)
    return value.keys.sort_by(&:to_s).to_h { |key| [key.to_s, canonical(value[key])] } if value.is_a?(Hash)
    return value.map { |item| canonical(item) } if value.is_a?(Array)
    value
  end
  class Reader
    def initialize(input)
      raise 'fixture original keys missing' unless input.keys.sort == %w[createdAt pathWithNamespace projectId tokenIds].sort
    end
    def runtime
      { bootId: '73fa6bd2-3c64-4d61-8ab3-fa4ff0cc372a', namespace: 'pid:[17]', readerPid: 42, readerStartedTick: '999' }
    end
  end
end
module Sidekiq
  class Queue
    def self.all
      [$queued]
    end
  end
  class ScheduledSet < Array
    def initialize
      super($scheduled)
    end
  end
  class RetrySet < Array
    def initialize
      super($retry)
    end
  end
  class WorkSet
    def size
      $active
    end
  end
end
require_relative 'runner'

module CrewstationGitlabActivityTest
  def self.assert(value, message)
    raise message unless value
  end
  def self.rejects(pattern)
    begin
      yield
    rescue StandardError => error
      assert(error.message.match?(pattern), "unexpected failure: #{error.message}")
      return
    end
    raise 'invalid activity source accepted'
  end
  def self.run
    $queued = []; $scheduled = []; $retry = []; $active = 0
    original = { 'project' => { 'id' => '383', 'pathWithNamespace' => 'group/original', 'createdAt' => '2026-09-30T16:00:35.872Z' },
      'pipelines' => [{ 'id' => '181' }], 'categories' => [{ 'objects' => [{ 'id' => '593' }] }],
      'runtime' => { 'bootId' => '73fa6bd2-3c64-4d61-8ab3-fa4ff0cc372a', 'namespace' => 'pid:[17]' }, 'nativeRevision' => 'a' * 64 }
    report = { 'source' => original['runtime'], 'identitiesDigest' => Digest::SHA256.hexdigest('[]'), 'consumers' => [] }
    reader = CrewstationGitlabActivity::Reader.new('original' => original, 'identities' => [], 'consumerReport' => report)
    metrics = { 9229 => "gitlab_workhorse_http_in_flight_requests 0\n", 9236 => "grpc_server_started_total{grpc_method=\"Read\",grpc_type=\"unary\"} 1.2e+01\ngrpc_server_handled_total{grpc_code=\"OK\",grpc_type=\"unary\",grpc_method=\"Read\"} 12\n" }
    reader.define_singleton_method(:metric) { |port| metrics.fetch(port) }
    first = reader.read
    assert(first[:gitalyInFlight].zero? && first[:workhorseInFlight].zero? && !first[:producersClosed], 'zero became closure proof')
    metrics[9236] = metrics[9236].sub('} 12', '} 11')
    assert(reader.read[:gitalyInFlight] == 1, 'in-flight RPC disappeared')
    metrics[9236] = metrics[9236].sub('} 11', '} 13')
    rejects(/metrics-inconsistent/) { reader.read }
    metrics[9236] = "grpc_server_started_total{grpc_method=\"Read\"} 12\n"
    rejects(/metrics-missing/) { reader.read }
    metrics[9236] = "grpc_server_started_total{grpc_method=\"Read\"} 12\ngrpc_server_handled_total{grpc_code=\"OK\",grpc_method=\"Read\"} 12\n"
    metrics[9229] = "gitlab_workhorse_http_in_flight_requests 0\ngitlab_workhorse_http_in_flight_requests 0\n"
    rejects(/metrics-invalid/) { reader.read }
    metrics[9229] = "gitlab_workhorse_http_in_flight_requests 0\n"
    $queued = [OpenStruct.new(item: { 'args' => [383] }), OpenStruct.new(item: { 'args' => [384] })]
    $scheduled = [OpenStruct.new(item: { 'args' => ['gid://gitlab/Project/383'] })]
    $retry = [OpenStruct.new(item: { 'args' => [], 'meta.project' => 'group/original' })]
    $active = 2
    current = reader.read
    assert(current[:queuedProjectJobs] == 3 && current[:sidekiqInFlight] == 2, 'original queued or active job disappeared')
    assert($queued.length == 2 && $scheduled.length == 1 && $retry.length == 1, 'source altered native jobs')
    report['identitiesDigest'] = 'e' * 64
    rejects(/consumer-report-invalid/) { reader.read }
    report['identitiesDigest'] = Digest::SHA256.hexdigest('[]')
    samples = [0, 1]; reader.define_singleton_method(:producers) { { workhorse: samples.shift, gitaly: 0, sidekiq: 0, queued: 0 } }
    rejects(/producers-changed/) { reader.read }
    puts JSON.generate({ standaloneActivityCases: 8, originalProjectTouched: false })
  end
end
CrewstationGitlabActivityTest.run
