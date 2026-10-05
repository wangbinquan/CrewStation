# frozen_string_literal: true

require 'net/http'
require 'set'
require 'sidekiq/api'

module CrewstationGitlabActivity
  class Reader
    def initialize(input)
      raise 'native-source-activity-version-unsupported' unless Gitlab::VERSION == CrewstationGitlabNative::VERSION
      raise 'native-source-activity-request-invalid' unless input.keys.sort == %w[consumerReport identities original]
      @original = input.fetch('original')
      @identities = input.fetch('identities')
      @consumer_report = input.fetch('consumerReport')
      @id = CrewstationGitlabNative.id(@original.fetch('project').fetch('id'))
    end

    def read
      before = producers
      source = { 'bootId' => @original.fetch('runtime').fetch('bootId'), 'namespace' => @original.fetch('runtime').fetch('namespace') }
      raise 'native-source-activity-consumer-report-invalid' unless @consumer_report.fetch('source') == source && @consumer_report.fetch('identitiesDigest') ==
        Digest::SHA256.hexdigest(JSON.generate(CrewstationGitlabNative.canonical(@identities)))
      consumers = @consumer_report.fetch('consumers')
      after = producers
      raise 'native-source-activity-producers-changed' unless before == after
      facts = { nativeRevision: @original.fetch('nativeRevision'), identitiesDigest: CrewstationGitlabNative.canonical(@identities),
        workhorseInFlight: before[:workhorse], gitalyInFlight: before[:gitaly], sidekiqInFlight: before[:sidekiq], queuedProjectJobs: before[:queued], consumers: consumers }
      facts[:identitiesDigest] = Digest::SHA256.hexdigest(JSON.generate(facts[:identitiesDigest]))
      revision = Digest::SHA256.hexdigest(JSON.generate(CrewstationGitlabNative.canonical(facts)))
      facts.merge(version: 1, complete: true, observedAt: Time.now.utc.iso8601(3), revision: revision,
        runtime: CrewstationGitlabNative::Reader.new('projectId' => @id.to_s, 'pathWithNamespace' => @original.fetch('project').fetch('pathWithNamespace'),
          'createdAt' => @original.fetch('project').fetch('createdAt'), 'tokenIds' => []).send(:runtime),
        physicalReclamationProven: false, producersClosed: false, consumersStopped: false)
    end

    private

    def metric(port)
      uri = URI("http://127.0.0.1:#{port}/metrics")
      Net::HTTP.start(uri.host, uri.port, nil, nil, nil, nil, open_timeout: 3, read_timeout: 5) do |client|
        response = client.get(uri.request_uri)
        raise 'native-source-activity-metrics-unavailable' unless response.code == '200' && response.body.bytesize <= 4_194_304
        response.body
      end
    end

    def samples(body, name)
      result = {}
      body.lines.each do |line|
        next if line.start_with?('#') || !line.start_with?(name + ' ', name + '{')
        found = line.strip.match(/\A#{Regexp.escape(name)}(?:\{(.*)\})? ([0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)\z/)
        raise 'native-source-activity-metrics-invalid' unless found
        number = Float(found[2])
        label = found[1] || ''
        raise 'native-source-activity-metrics-invalid' unless number.finite? && number >= 0 && number.to_i == number && number <= 9_007_199_254_740_991 && !result.key?(label)
        result[label] = number.to_i
      end
      result
    end

    def gitaly
      body = metric(9236)
      started = samples(body, 'grpc_server_started_total')
      handled = samples(body, 'grpc_server_handled_total')
      raise 'native-source-activity-gitaly-metrics-missing' if started.empty? || handled.empty?
      totals = Hash.new(0)
      handled.each do |labels, count|
        key = labels.split(',').reject { |value| value.start_with?('grpc_code=') }.sort.join(',')
        totals[key] += count
      end
      values = started.map do |labels, count|
        key = labels.split(',').sort.join(',')
        raise 'native-source-activity-gitaly-metrics-inconsistent' unless totals.key?(key) && totals[key] <= count
        count - totals.delete(key)
      end
      raise 'native-source-activity-gitaly-metrics-inconsistent' unless totals.empty?
      values.sum
    end

    def related?(job)
      # Preserve jobs that directly carry any retained native ID or the original
      # project context. Unknown model records are separately queried by native
      # Remaining after parent removal; queue ACKs are never deletion evidence.
      ids = [@id.to_s] + @original.fetch('pipelines').map { |row| row.fetch('id') } +
        @original.fetch('categories').flat_map { |row| row.fetch('objects').map { |item| item.fetch('id') } }
      wanted = ids.to_set
      context = job['meta.project'] || job.dig('meta', 'project')
      return true if context == @original.fetch('project').fetch('pathWithNamespace') || job['project_id'].to_s == @id.to_s
      scan = lambda do |value|
        case value
        when Array then value.any? { |item| scan.call(item) }
        when Hash then value.values.any? { |item| scan.call(item) }
        when Integer then wanted.include?(value.to_s)
        when String then wanted.include?(value) || value == @original.fetch('project').fetch('pathWithNamespace') || value.match?(%r{\Agid://gitlab/Project/#{@id}\z})
        else false
        end
      end
      scan.call(job.fetch('args', []))
    end

    def queued
      total = 0
      count = 0
      sets = Sidekiq::Queue.all + [Sidekiq::ScheduledSet.new, Sidekiq::RetrySet.new]
      sets.each do |set|
        set.each do |entry|
          count += 1
          raise 'native-source-activity-queue-budget' if count > 100_000
          total += 1 if related?(entry.item)
        end
      end
      total
    end

    def producers
      workhorse = samples(metric(9229), 'gitlab_workhorse_http_in_flight_requests')
      raise 'native-source-activity-workhorse-metrics-missing' if workhorse.empty?
      { workhorse: workhorse.values.sum, gitaly: gitaly, sidekiq: Sidekiq::WorkSet.new.size, queued: queued }
    end
  end
end

if ENV['CS_GITLAB_ACTIVITY_READ'] == '1'
  raw = STDIN.read(8_388_609)
  raise 'native-source-activity-request-budget' if raw.bytesize > 8_388_608
  puts 'CS_GITLAB_ACTIVITY=' + JSON.generate(Timeout.timeout(80) { CrewstationGitlabActivity::Reader.new(JSON.parse(raw)).read })
end
