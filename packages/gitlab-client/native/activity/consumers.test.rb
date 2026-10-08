# frozen_string_literal: true

require_relative 'consumers' unless defined?(CrewstationGitlabActivity::Consumers)
require_relative 'manifest' unless defined?(CrewstationGitlabActivity.runtime)
require 'tmpdir'
require 'fiddle'

module CrewstationGitlabConsumerTest
  def self.assert(value, message)
    raise message unless value
  end

  def self.run
    Dir.mktmpdir('crewstation-consumers-') do |base|
      path = File.join(base, 'retained')
      File.write(path, 'x' * 4096)
      handle = File.open(path)
      stat = handle.stat
      target = [{ 'device' => stat.dev.to_s, 'inode' => stat.ino.to_s }]
      raw = File.read('/proc/self/stat')
      tick = raw[(raw.rindex(') ') + 2)..].split.fetch(19)
      processes = [{ 'pid' => Process.pid, 'uid' => Process.euid.to_s, 'startedTick' => tick }]
      read = ->(identities = target) { CrewstationGitlabActivity::Consumers.new(identities, processes).read }
      refs = read.call
      assert(refs.any? { |row| row[:kind] == 'descriptor' && row[:pid] == Process.pid && row[:startedTick] == tick }, 'open descriptor not observed')
      birth_cases(path, processes)
      File.unlink(path)
      assert(read.call.any? { |row| row[:kind] == 'descriptor' }, 'unlinked held inode not observed')
      handle.close
      assert(read.call.empty?, 'closed descriptor became an occupied inode')
      mapping_cases(path, read)
      previous = Dir.pwd
      begin
        Dir.chdir(base)
        cwd = File.stat(base)
        target = [{ 'device' => cwd.dev.to_s, 'inode' => cwd.ino.to_s }]
        assert(read.call(target).any? { |row| row[:kind] == 'cwd' }, 'thread working directory not observed')
        full = target.map { |row| row.merge('birthtimeNs' => birth(base)) }
        assert(read.call(full).any? { |row| row[:kind] == 'cwd' && row[:birthtimeNs] == full.first['birthtimeNs'] }, 'working directory birth lost')
        assert(read.call(full.map { |row| row.merge('birthtimeNs' => (row['birthtimeNs'].to_i + 1).to_s) }).empty?, 'different working directory birth accepted')
      ensure
        Dir.chdir(previous)
      end
      exe = File.stat('/proc/self/exe')
      target = [{ 'device' => exe.dev.to_s, 'inode' => exe.ino.to_s }]
      assert(read.call(target).any? { |row| row[:kind] == 'executable' }, 'executable not observed')
      assert(read.call(target.map { |row| row.merge('birthtimeNs' => birth('/proc/self/exe')) }).any? { |row| row[:kind] == 'executable' && row[:birthtimeNs] }, 'executable birth lost')
      root = File.stat('/proc/self/root')
      assert(read.call([{ 'device' => root.dev.to_s, 'inode' => root.ino.to_s, 'birthtimeNs' => birth('/proc/self/root') }]).any? { |row| row[:kind] == 'root' && row[:birthtimeNs] }, 'filesystem root birth lost')
      changed = [{ 'pid' => Process.pid, 'uid' => Process.euid.to_s, 'startedTick' => (tick.to_i + 1).to_s }]
      begin
        CrewstationGitlabActivity::Consumers.new(target, changed).read
        raise 'substituted birth accepted'
      rescue RuntimeError => error
        assert(error.message.include?('process-substituted'), 'unexpected original birth failure')
      end
      puts JSON.generate({ standaloneConsumerCases: 22, originalProjectTouched: false })
    end
  end

  def self.mapping_cases(path, read)
      File.write(path, 'x' * 4096)
      handle = File.open(path)
      target = [{ 'device' => handle.stat.dev.to_s, 'inode' => handle.stat.ino.to_s }]
      full = target.map { |row| row.merge('birthtimeNs' => birth(path)) }
      mmap = Fiddle::Function.new(Fiddle.dlopen(nil)['mmap'], [Fiddle::TYPE_VOIDP, Fiddle::TYPE_LONG, Fiddle::TYPE_INT, Fiddle::TYPE_INT, Fiddle::TYPE_INT, Fiddle::TYPE_LONG], Fiddle::TYPE_VOIDP)
      memory = mmap.call(0, 4096, 1, 2, handle.fileno, 0)
      raise 'fixture-mmap-failed' if memory.to_i == -1
      handle.close
      begin
        assert(read.call(target).any? { |row| row[:kind] == 'mapping' }, 'mapping without descriptor not observed')
        assert(read.call(full).any? { |row| row[:kind] == 'mapping' && row[:birthtimeNs] == full.first['birthtimeNs'] }, 'mapping birth lost')
        assert(read.call(full.map { |row| row.merge('birthtimeNs' => (row['birthtimeNs'].to_i + 1).to_s) }).empty?, 'different mapped file birth accepted')
        File.unlink(path)
        assert(read.call(full).any? { |row| row[:kind] == 'mapping' }, 'unlinked original mapping lost')
      ensure
        munmap = Fiddle::Function.new(Fiddle.dlopen(nil)['munmap'], [Fiddle::TYPE_VOIDP, Fiddle::TYPE_LONG], Fiddle::TYPE_INT)
        assert(munmap.call(memory, 4096).zero?, 'fixture mapping not released')
      end
      assert(read.call(target).empty?, 'unmapped inode became occupied')
  end

  def self.birth(path)
    call = Fiddle::Function.new(Fiddle.dlopen(nil)['statx'], [Fiddle::TYPE_INT, Fiddle::TYPE_VOIDP, Fiddle::TYPE_INT, Fiddle::TYPE_INT, Fiddle::TYPE_VOIDP], Fiddle::TYPE_INT)
    data = Fiddle::Pointer.malloc(256, Fiddle::RUBY_FREE)
    raise 'fixture-birth-unavailable' unless call.call(-100, path, 0, 0xfff, data).zero? && (data[0, 4].unpack1('L') & 0x800) != 0
    seconds, nanos = data[80, 16].unpack('qL')
    (seconds * 1_000_000_000 + nanos).to_s
  end

  def self.birth_cases(path, processes)
    stat = File.stat(path)
    target = { 'device' => stat.dev.to_s, 'inode' => stat.ino.to_s, 'birthtimeNs' => birth(path) }
    read = ->(rows) { CrewstationGitlabActivity::Consumers.new(rows, processes).read }
    assert(read.call([target]).any? { |row| row[:kind] == 'descriptor' && row[:birthtimeNs] == target['birthtimeNs'] }, 'original descriptor birth lost')
    # A reused inode is another file only when its actual birth is positively different.
    wrong = target.merge('birthtimeNs' => (target['birthtimeNs'].to_i + 1).to_s)
    assert(read.call([wrong]).empty?, 'different birth mistaken for original consumer')
    assert(read.call([target, wrong]).any? { |row| row[:birthtimeNs] == target['birthtimeNs'] }, 'distinct births collapsed')
    renamed = path + '-renamed'
    File.rename(path, renamed)
    begin
      assert(read.call([target]).any? { |row| row[:kind] == 'descriptor' }, 'renamed original consumer lost')
      File.unlink(renamed)
      assert(read.call([target]).any? { |row| row[:kind] == 'descriptor' }, 'deleted original consumer lost')
    ensure
      File.rename(renamed, path) if File.exist?(renamed)
      File.write(path, 'x' * 4096) unless File.exist?(path)
    end
    unknown = Class.new(CrewstationGitlabActivity::Consumers) { def birth(*); nil; end }
    assert(unknown.new([target], processes).read.any? { |row| row[:kind] == 'descriptor' && !row.key?(:birthtimeNs) }, 'unknown birth interpreted as absent')
    begin
      read.call([target, target.slice('device', 'inode')])
      raise 'ambiguous birth accepted'
    rescue RuntimeError => error
      assert(error.message.include?('identities-duplicate'), 'unexpected ambiguity error')
    end
  end
end

CrewstationGitlabConsumerTest.run
