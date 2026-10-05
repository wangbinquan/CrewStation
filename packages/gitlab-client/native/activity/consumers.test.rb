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
      File.unlink(path)
      assert(read.call.any? { |row| row[:kind] == 'descriptor' }, 'unlinked held inode not observed')
      handle.close
      assert(read.call.empty?, 'closed descriptor became an occupied inode')
      File.write(path, 'x' * 4096)
      handle = File.open(path)
      target = [{ 'device' => handle.stat.dev.to_s, 'inode' => handle.stat.ino.to_s }]
      mmap = Fiddle::Function.new(Fiddle.dlopen(nil)['mmap'], [Fiddle::TYPE_VOIDP, Fiddle::TYPE_LONG, Fiddle::TYPE_INT, Fiddle::TYPE_INT, Fiddle::TYPE_INT, Fiddle::TYPE_LONG], Fiddle::TYPE_VOIDP)
      memory = mmap.call(0, 4096, 1, 2, handle.fileno, 0)
      raise 'fixture-mmap-failed' if memory.to_i == -1
      handle.close
      begin
        assert(read.call.any? { |row| row[:kind] == 'mapping' }, 'mapping without descriptor not observed')
      ensure
        munmap = Fiddle::Function.new(Fiddle.dlopen(nil)['munmap'], [Fiddle::TYPE_VOIDP, Fiddle::TYPE_LONG], Fiddle::TYPE_INT)
        assert(munmap.call(memory, 4096).zero?, 'fixture mapping not released')
      end
      assert(read.call.empty?, 'unmapped inode became occupied')
      previous = Dir.pwd
      begin
        Dir.chdir(base)
        cwd = File.stat(base)
        refs = read.call([{ 'device' => cwd.dev.to_s, 'inode' => cwd.ino.to_s }])
        assert(refs.any? { |row| row[:kind] == 'cwd' }, 'thread working directory not observed')
      ensure
        Dir.chdir(previous)
      end
      exe = File.stat('/proc/self/exe')
      assert(read.call([{ 'device' => exe.dev.to_s, 'inode' => exe.ino.to_s }]).any? { |row| row[:kind] == 'executable' }, 'executable not observed')
      changed = [{ 'pid' => Process.pid, 'uid' => Process.euid.to_s, 'startedTick' => (tick.to_i + 1).to_s }]
      begin
        CrewstationGitlabActivity::Consumers.new(target, changed).read
        raise 'substituted birth accepted'
      rescue RuntimeError => error
        assert(error.message.include?('process-substituted'), 'unexpected original birth failure')
      end
      puts JSON.generate({ standaloneConsumerCases: 8, originalProjectTouched: false })
    end
  end
end

CrewstationGitlabConsumerTest.run
