# frozen_string_literal: true

# Inspect every visible thread's descriptors, mappings and filesystem context.
# Never read the contents of a project file or signal a process.
module CrewstationGitlabActivity
  class Consumers
    LIMIT = 100_000

    def initialize(identities, processes = nil)
      raise 'native-source-activity-identities-invalid' unless identities.is_a?(Array) && identities.length <= LIMIT
      @targets = identities.to_h do |row|
        raise 'native-source-activity-identity-invalid' unless row.keys.sort == %w[device inode] &&
          row.values.all? { |value| value.is_a?(String) && value.match?(/\A[0-9]{1,20}\z/) && value.to_i <= 18_446_744_073_709_551_615 } && row['inode'] != '0'
        [[row['device'], row['inode']], true]
      end
      raise 'native-source-activity-identities-duplicate' unless @targets.length == identities.length
      @references = []
      @inspected = 0
      @processes = processes
    end

    def read
      before = pids
      before.each do |pid|
        process = status("/proc/#{pid}/stat")
        expected = @processes && @processes.find { |row| row['pid'] == pid }
        raise 'native-source-activity-process-substituted' if expected && (expected['startedTick'] != process[:tick] || expected['uid'] != Process.euid.to_s)
        next if process[:state] == 'Z'
        threads = ids("/proc/#{pid}/task")
        threads.each { |tid| thread(pid, tid, process[:tick]) }
        raise 'native-source-activity-process-changed' unless status("/proc/#{pid}/stat")[:tick] == process[:tick] && ids("/proc/#{pid}/task") == threads
      end
      raise 'native-source-activity-process-set-changed' unless pids == before
      @references.sort_by { |row| [row[:pid], row[:tid], row[:kind], row[:device], row[:inode]] }
    end

    private

    def ids(path)
      Dir.children(path).grep(/\A[1-9][0-9]*\z/).map(&:to_i).sort
    end

    def pids
      @processes ? @processes.map { |row| row.fetch('pid') }.sort : ids('/proc')
    end

    def status(path)
      raw = File.read(path)
      close = raw.rindex(') ')
      raise 'native-source-activity-stat-invalid' unless close
      fields = raw[(close + 2)..].split
      tick = fields.fetch(19)
      raise 'native-source-activity-stat-invalid' unless tick.match?(/\A[1-9][0-9]*\z/)
      { state: fields.fetch(0), tick: tick }
    end

    def reference(pid, tid, started, kind, device, inode)
      @inspected += 1
      raise 'native-source-activity-inspection-budget' if @inspected > 2_000_000
      return unless @targets.key?([device, inode])
      raise 'native-source-activity-reference-budget' if @references.length >= LIMIT
      @references << { pid: pid, tid: tid, startedTick: started, kind: kind, device: device, inode: inode }
    end

    def descriptor(pid, tid, started, kind, path)
      stat = File.stat(path)
      reference(pid, tid, started, kind, stat.dev.to_s, stat.ino.to_s)
    rescue Errno::ENOENT
      # A descriptor closed while scanning is no longer a consumer. The owning
      # thread's original birth is checked again after all reads.
      raise unless kind == 'descriptor'
    end

    def thread(pid, tid, process_started)
      path = "/proc/#{pid}/task/#{tid}"
      before = status(path + '/stat')
      return if before[:state] == 'Z'
      started = process_started
      Dir.children(path + '/fd').grep(/\A[0-9]+\z/).each { |fd| descriptor(pid, tid, started, 'descriptor', path + '/fd/' + fd) }
      %w[cwd root exe].each do |name|
        descriptor(pid, tid, started, { 'cwd' => 'cwd', 'root' => 'root', 'exe' => 'executable' }.fetch(name), path + '/' + name)
      end
      File.foreach(path + '/maps') do |line|
        fields = line.split(' ', 6)
        raise 'native-source-activity-mapping-invalid' unless fields.length >= 5 && fields[3].match?(/\A[0-9a-f]+:[0-9a-f]+\z/) && fields[4].match?(/\A[0-9]+\z/)
        next if fields[4] == '0'
        major, minor = fields[3].split(':').map { |value| value.to_i(16) }
        device = ((major & 0xfff) << 8) | (minor & 0xff) | ((minor & 0xfff00) << 12) | ((major & ~0xfff) << 32)
        reference(pid, tid, started, 'mapping', device.to_s, fields[4])
      end
      raise 'native-source-activity-thread-changed' unless status(path + '/stat')[:tick] == before[:tick]
    end
  end
end
