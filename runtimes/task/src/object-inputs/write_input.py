"""One bounded immutable input: directory-relative no-follow opens, fsync, no-overwrite publish."""
import hashlib
import json
import os
import stat
import sys
import uuid


def digest_file(fd):
    digest = hashlib.sha256()
    total = 0
    while True:
        part = os.read(fd, 65536)
        if not part:
            return total, digest.hexdigest()
        total += len(part)
        digest.update(part)


def materialize(spec):
    pieces = spec["path"].split("/")
    if any(not p or p in (".", "..", ".crewstation") for p in pieces):
        raise ValueError("unsafe input path")
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    directory = os.open(spec["root"], flags)
    temporary = ".cs-input-" + uuid.uuid4().hex
    output = None
    try:
        for piece in pieces[:-1]:
            created = False
            try:
                os.mkdir(piece, 0o755, dir_fd=directory)
                created = True
            except FileExistsError:
                pass
            child = os.open(piece, flags, dir_fd=directory)
            if created:
                os.fchown(child, spec["uid"], spec["gid"])
                os.fsync(directory)
            os.close(directory)
            directory = child
        output = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=directory)
        digest = hashlib.sha256()
        total = 0
        while True:
            part = sys.stdin.buffer.read(65536)
            if not part:
                break
            total += len(part)
            if total > spec["size"]:
                raise ValueError("input size mismatch")
            digest.update(part)
            view = memoryview(part)
            while view:
                view = view[os.write(output, view):]
        if total != spec["size"] or digest.hexdigest() != spec["sha256"]:
            raise ValueError("input digest mismatch")
        os.fchown(output, spec["uid"], spec["gid"])
        os.fsync(output)
        try:
            os.link(temporary, pieces[-1], src_dir_fd=directory, dst_dir_fd=directory, follow_symlinks=False)
        except FileExistsError:
            previous = os.open(pieces[-1], os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
            try:
                if not stat.S_ISREG(os.fstat(previous).st_mode) or digest_file(previous) != (total, spec["sha256"]):
                    raise ValueError("existing input differs")
            finally:
                os.close(previous)
        os.fsync(directory)
    finally:
        if output is not None:
            os.close(output)
            os.unlink(temporary, dir_fd=directory)
            os.fsync(directory)
        os.close(directory)


try:
    materialize(json.loads(sys.argv[1]))
except Exception:
    # Do not echo input contents, credentials or arbitrary filesystem exception text.
    print("Task input cannot be safely materialized", file=sys.stderr)
    sys.exit(1)
