# frozen_string_literal: true

require 'json'
require 'digest'
require 'time'
require 'timeout'

module CrewstationGitlabActivity
  def self.canonical(value)
    return value.keys.sort_by(&:to_s).to_h { |key| [key.to_s, canonical(value[key])] } if value.is_a?(Hash)
    return value.map { |item| canonical(item) } if value.is_a?(Array)
    value
  end

  def self.digest(value)
    Digest::SHA256.hexdigest(JSON.generate(canonical(value)))
  end

  def self.runtime
    { bootId: File.read('/proc/sys/kernel/random/boot_id').strip, namespace: File.readlink('/proc/self/ns/pid') }
  end

  def self.manifest
    ids = -> { Dir.children('/proc').grep(/\A[1-9][0-9]*\z/).map(&:to_i).reject { |pid| pid == Process.pid }.sort }
    before = ids.call
    processes = before.map do |pid|
      status = File.read("/proc/#{pid}/status")
      match = status.match(/^Uid:\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)$/)
      raise 'native-source-activity-uid-unsupported' unless match && match.captures.uniq.length == 1
      raw = File.read("/proc/#{pid}/stat")
      fields = raw[(raw.rindex(') ') + 2)..].split
      { pid: pid, uid: match[1], startedTick: fields.fetch(19) }
    end
    raise 'native-source-activity-process-set-changed' unless ids.call == before
    source = runtime
    { version: 1, source: source, processes: processes, revision: digest(source: source, processes: processes) }
  end

  def self.execute(input)
    if input['mode'] == 'manifest'
      raise 'native-source-activity-manifest-request-invalid' unless input.keys == ['mode']
      return manifest
    end
    raise 'native-source-activity-consume-request-invalid' unless input.keys.sort == %w[identities mode original].sort && input['mode'] == 'consume'
    original = input.fetch('original')
    raise 'native-source-activity-original-manifest-invalid' unless original.fetch('revision') == digest(source: original.fetch('source'), processes: original.fetch('processes')) &&
      runtime.transform_keys(&:to_s) == original.fetch('source')
    processes = original.fetch('processes').select { |row| row['uid'] == Process.euid.to_s }
    refs = Consumers.new(input.fetch('identities'), processes).read
    { version: 1, source: original.fetch('source'), originalRevision: original.fetch('revision'), uid: Process.euid.to_s,
      consumers: refs, identitiesDigest: digest(input.fetch('identities')) }
  end
end

if ENV['CS_GITLAB_CONSUMERS_READ'] == '1'
  raw = STDIN.read(8_388_609)
  raise 'native-source-activity-consumer-request-budget' if raw.bytesize > 8_388_608
  puts 'CS_GITLAB_CONSUMERS=' + JSON.generate(Timeout.timeout(60) { CrewstationGitlabActivity.execute(JSON.parse(raw)) })
end
