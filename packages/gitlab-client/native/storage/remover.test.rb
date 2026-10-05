# frozen_string_literal: true

require_relative 'reader' unless defined?(CrewstationGitlabStorage::Reader)
require_relative 'remover' unless defined?(CrewstationGitlabStorage::Remover)
require 'tmpdir'
require 'fileutils'

module CrewstationGitlabRemovalTest
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
    raise 'unsafe file removal accepted'
  end
  def self.run
    Dir.mktmpdir('crewstation-storage-remover-') do |base|
      roots = CrewstationGitlabStorage::ROOTS.map do |kind|
        path = File.join(base, kind); Dir.mkdir(path)
        identity = File.open(path) { |file| CrewstationGitlabStorage.metadata(file).slice(:device, :inode, :birthtimeNs, :kind) }
        { 'kind' => kind, 'path' => path, 'identity' => identity.transform_keys(&:to_s) }
      end
      root = roots.find { |row| row['kind'] == 'repository' }.fetch('path')
      foreign = File.join(root, 'foreign.git'); Dir.mkdir(foreign); File.write(File.join(foreign, 'keep'), 'foreign data')
      make = lambda do |name|
        path = File.join(root, name); Dir.mkdir(path); Dir.mkdir(File.join(path, 'objects'))
        File.write(File.join(path, 'objects', '原文件'), 'owned bytes'); path
      end
      read = lambda do |name, mode = 'tree'|
        input = { 'roots' => roots, 'request' => { 'locations' => [{ 'key' => name, 'root' => 'repository', 'relative' => name, 'mode' => mode }] } }
        JSON.parse(JSON.generate(CrewstationGitlabStorage::Reader.new(input).read))
      end
      remove = ->(original) { CrewstationGitlabStorage::Remover.new({ 'roots' => roots, 'original' => original }).remove }
      owned = make.call('owned.git'); original = read.call('owned.git'); receipt = remove.call(original)
      assert(!File.exist?(owned) && receipt[:removedEntries] == 3, 'original tree not removed')
      assert(File.read(File.join(foreign, 'keep')) == 'foreign data', 'foreign project changed')
      assert(!receipt[:physicalReclamationProven] && !receipt[:producersClosed] && !receipt[:consumersStopped], 'local unlink became full project proof')
      assert(remove.call(original)[:removedEntries].zero?, 'completed removal not replayable')
      owned = make.call('partial.git'); original = read.call('partial.git'); File.unlink(File.join(owned, 'objects', '原文件'))
      assert(remove.call(original)[:removedEntries] == 2 && !File.exist?(owned), 'partial removal not recoverable')
      owned = make.call('replaced.git'); original = read.call('replaced.git')
      File.rename(owned, File.join(root, 'original-kept.git')); make.call('replaced.git')
      rejects(/entry-substituted/) { remove.call(original) }
      assert(File.exist?(File.join(owned, 'objects', '原文件')) && File.exist?(File.join(root, 'original-kept.git', 'objects', '原文件')), 'replacement or original removed')
      owned = make.call('changed.git'); original = read.call('changed.git'); File.write(File.join(owned, 'objects', 'new'), 'late write')
      rejects(/entry-substituted/) { remove.call(original) }
      assert(File.exist?(File.join(owned, 'objects', '原文件')), 'new content caused partial erasure')
      owned = make.call('modified.git'); original = read.call('modified.git'); File.write(File.join(owned, 'objects', '原文件'), 'changed content')
      rejects(/entry-substituted/) { remove.call(original) }
      assert(File.read(File.join(owned, 'objects', '原文件')) == 'changed content', 'changed bytes removed')
      owned = make.call('linked.git'); File.link(File.join(owned, 'objects', '原文件'), File.join(foreign, 'shared'))
      original = read.call('linked.git'); rejects(/shared-file/) { remove.call(original) }
      assert(File.exist?(File.join(owned, 'objects', '原文件')) && File.exist?(File.join(foreign, 'shared')), 'shared inode removed')
      owned = make.call('alias.git'); original = read.call('alias.git'); File.unlink(File.join(owned, 'objects', '原文件')); File.symlink('/etc/passwd', File.join(owned, 'objects', '原文件'))
      rejects(/Too many levels|symbolic link/i) { remove.call(original) }
      original = read.call('missing.git'); make.call('missing.git'); rejects(/location-substituted/) { remove.call(original) }
      owned = make.call('overlap.git'); original = read.call('overlap.git')
      duplicate = JSON.parse(JSON.generate(original['locations'].first)); duplicate['key'] = 'overlapping'
      original['locations'] << duplicate; original['revision'] = CrewstationGitlabStorage.digest({ roots: roots, locations: original['locations'] })
      rejects(/overlap/) { remove.call(original) }; assert(File.exist?(owned), 'overlap removed content')
      original = read.call('replaced.git'); original['revision'] = '0' * 64
      rejects(/snapshot-invalid/) { remove.call(original) }
      original = read.call('replaced.git'); replacement = File.join(base, 'replacement'); Dir.mkdir(replacement)
      File.rename(root, File.join(base, 'old-root')); File.rename(replacement, root)
      rejects(/original-root-changed/) { remove.call(original) }
      assert(File.read(File.join(base, 'old-root', 'foreign.git', 'keep')) == 'foreign data', 'original foreign bytes changed')
      puts JSON.generate({ standaloneRemovalCases: 12, nativeDatabasesOpened: false, originalProjectTouched: false, foreignFilesPreserved: true })
    end
  end
end
CrewstationGitlabRemovalTest.run
