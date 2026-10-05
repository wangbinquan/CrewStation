# frozen_string_literal: true

require_relative 'reader' unless defined?(CrewstationGitlabStorage)
require 'tmpdir'
require 'fileutils'

module CrewstationGitlabStorageTest
  def self.assert(value, message)
    raise message unless value
  end

  def self.rejects(pattern)
    begin
      yield
    rescue StandardError => error
      assert(error.message.match?(pattern), "unexpected rejection: #{error.class}: #{error.message}")
      return
    end
    raise 'unsafe filesystem observation accepted'
  end

  def self.run
    Dir.mktmpdir('crewstation-storage-reader-') do |base|
      roots = CrewstationGitlabStorage::ROOTS.map do |kind|
        path = File.join(base, kind)
        Dir.mkdir(path)
        identity = File.open(path) { |file| CrewstationGitlabStorage.metadata(file).slice(:device, :inode, :birthtimeNs, :kind) }
        { 'kind' => kind, 'path' => path, 'identity' => identity.transform_keys(&:to_s) }
      end
      repository = roots.find { |root| root['kind'] == 'repository' }.fetch('path')
      FileUtils.mkdir_p(File.join(repository, 'retained.git', 'objects'))
      File.write(File.join(repository, 'retained.git', 'objects', '原文件'), 'fixture bytes')
      scope = lambda do |relative, mode = 'tree'|
        { 'roots' => roots, 'request' => { 'locations' => [{ 'key' => 'retained', 'root' => 'repository', 'relative' => relative, 'mode' => mode }] } }
      end
      read = ->(relative, mode = 'tree') { CrewstationGitlabStorage::Reader.new(scope.call(relative, mode)).read }
      first = read.call('retained.git')
      entries = first.fetch(:locations).first.fetch(:entries)
      assert(entries.length == 3 && entries.sum { |entry| entry[:bytes] } == 13, 'descriptor tree incomplete')
      assert(entries.any? { |entry| entry[:path] == 'retained.git/objects/原文件' && entry[:birthtimeNs].to_i.positive? }, 'original epoch absent')
      assert(!first[:physicalReclamationProven] && !first[:producersClosed] && !first[:consumersStopped], 'observation became deletion proof')
      File.rename(File.join(repository, 'retained.git'), File.join(repository, 'removed.git'))
      assert(read.call('retained.git')[:locations].first[:present] == false, 'absent original location not observed')
      assert(read.call('removed.git')[:locations].first[:entries].length == 3, 'retained files depended on native parent')
      rejects(/location-kind-changed/) { read.call('removed.git/objects/原文件') }
      rejects(/location-kind-changed/) { read.call('removed.git', 'file') }
      rejects(/storage-name-unsupported/) { read.call('../outside') }
      File.symlink('/etc', File.join(repository, 'outside'))
      rejects(/Too many levels|symbolic link/i) { read.call('outside') }
      File.mkfifo(File.join(repository, 'pipe'))
      rejects(/entry-unsupported/) { read.call('pipe', 'file') }
      deeper = File.join(repository, 'deep')
      50.times { deeper = File.join(deeper, 'x'); FileUtils.mkdir_p(deeper) }
      rejects(/depth-exceeded/) { read.call('deep') }
      replacement = File.join(base, 'replacement')
      Dir.mkdir(replacement)
      File.rename(repository, File.join(base, 'old-repository'))
      File.rename(replacement, repository)
      rejects(/original-root-changed/) { read.call('missing') }
      puts JSON.generate({ standaloneFilesystemCases: 10, readonlyNativeParent: true, originalProjectTouched: false })
    end
  end
end

CrewstationGitlabStorageTest.run
