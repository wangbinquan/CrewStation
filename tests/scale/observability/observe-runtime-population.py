"""Measure the original owned Bun and PostgreSQL, without changing the fixed corpus."""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import select
import shutil
import signal
import stat
import subprocess
import sys
import time


def process_tree(pid):
    pending, seen = [pid], set()
    while pending:
        current = pending.pop()
        if current in seen:
            continue
        seen.add(current)
        try:
            pending.extend(int(n) for n in Path(f"/proc/{current}/task/{current}/children").read_text().split())
        except (OSError, ValueError):
            pass
    return seen


def signal_children(wrapper, number):
    sent = 0
    for child in process_tree(wrapper) - {wrapper}:
        handle = None
        try:
            handle = os.pidfd_open(child)
            if os.getpgid(child) == wrapper:
                signal.pidfd_send_signal(handle, number)
                sent += 1
        except ProcessLookupError:
            pass
        finally:
            if handle is not None:
                os.close(handle)
    return sent


def stop_measured(child):
    # GNU time survives to reap the actual Bun and write its real RUSAGE.
    signal_children(child.pid, signal.SIGTERM)
    try:
        return child.wait(timeout=30)
    except subprocess.TimeoutExpired:
        signal_children(child.pid, signal.SIGKILL)
        return child.wait(timeout=30)


def interruption_control(directory, source):
    directory.mkdir(parents=True)
    receipt = {"sourceSha": source, "kind": "measurement-control", "fullScaleQualification": False, "verdict": "FAIL", "cases": []}
    try:
        for number in (signal.SIGTERM, signal.SIGKILL):
            output = directory / f"process-time-{number}.txt"
            fixture = "const memory=new Uint8Array(16*1024*1024);memory.fill(1);console.log(JSON.stringify({pid:process.pid}));setInterval(()=>{if(memory[0]!==1)process.exit(2)},1000)"
            child = subprocess.Popen(["/usr/bin/time", "-v", "-o", str(output), "bun", "-e", fixture], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True, text=True)
            try:
                assert select.select([child.stdout], [], [], 10)[0], "Measured Bun did not start"
                measured = json.loads(child.stdout.readline())["pid"]
                assert measured != child.pid and measured in process_tree(child.pid)
                assert signal_children(child.pid, number) >= 1
                code = child.wait(timeout=30)
                peak = re.search(r"Maximum resident set size \(kbytes\):\s*(\d+)", output.read_text())
                assert code != 0 and peak and int(peak[1]) > 0
                receipt["cases"].append({"signal": int(number), "measuredBunPid": measured, "exitCode": code, "osPeakRssKbytes": int(peak[1])})
            finally:
                if child.poll() is None:
                    stop_measured(child)
                child.stdout.close()
        receipt["verdict"] = "PASS"
    except BaseException as error:
        receipt["error"] = str(error)
        raise
    finally:
        (directory / "control.json").write_text(json.dumps(receipt, indent=2) + "\n")
        print(json.dumps(receipt), flush=True)
    return 0


def bun_disk(directory, pid):
    files, visible, opened = {}, 0, 0
    for root, _, names in os.walk(directory):
        for name in names:
            try:
                info = os.stat(Path(root) / name, follow_symlinks=False)
                key = (info.st_dev, info.st_ino)
                if stat.S_ISREG(info.st_mode) and key not in files:
                    files[key] = info.st_blocks * 512
                    visible += files[key]
            except OSError:
                pass
    for child in process_tree(pid):
        try:
            descriptors = list(Path(f"/proc/{child}/fd").iterdir())
        except OSError:
            continue
        for descriptor in descriptors:
            try:
                path = os.readlink(descriptor)
                if not path.startswith(str(directory) + os.sep):
                    continue
                info = descriptor.stat()
                key = (info.st_dev, info.st_ino)
                if stat.S_ISREG(info.st_mode) and key not in files:
                    files[key] = info.st_blocks * 512
                    opened += files[key]
            except OSError:
                pass
    return {"bunVisibleAllocatedBytes": visible, "bunOpenUnlinkedAllocatedBytes": opened}


POSTGRES_SAMPLE = r'''
set -eu
data="${PGDATA:-/var/lib/postgresql/data}"
db="$data/base/$1"
printf 'WAL %s\n' "$(du -s -B1 "$data/pg_wal" | awk '{print $1}')"
if [ -d "$db" ]; then
  printf 'DATABASE %s\n' "$(du -s -B1 "$db" | awk '{print $1}')"
  find "$db" -type f -name 't[0-9]*_[0-9]*' -exec stat -c 'TEMP %d:%i %b' {} +
fi
find "$data/base" -type f -path '*/pgsql_tmp/*' -exec stat -c 'TEMP %d:%i %b' {} +
for proc in /proc/[0-9]*; do
  [ "$(cat "$proc/comm" 2>/dev/null || true)" = postgres ] || continue
  awk '/^VmRSS:/{printf "RSS %s\n", $2 * 1024}' "$proc/status" 2>/dev/null || [ ! -d "$proc" ]
  for fd in "$proc"/fd/*; do
    target="$(readlink "$fd" 2>/dev/null || true)"
    case "$target" in
      "$data"/*' (deleted)') stat -Lc 'OPEN %d:%i %b' "$fd" 2>/dev/null || true ;;
    esac
  done
done
'''


def postgres_sample(container, directory):
    original = directory / "case/original-database.json"
    oid = json.loads(original.read_text())["oid"] if original.exists() else "0"
    assert re.fullmatch(r"\d+", oid)
    process = subprocess.run(["docker", "exec", "-i", "--user", "postgres", container, "sh", "-s", "--", oid], input=POSTGRES_SAMPLE, text=True, capture_output=True, timeout=20)
    assert process.returncode == 0, process.stderr
    db, wal, rss, temp, opened = 0, None, [], {}, {}
    for line in process.stdout.splitlines():
        kind, *values = line.split()
        if kind == "DATABASE":
            db = int(values[0])
        elif kind == "WAL":
            wal = int(values[0])
        elif kind == "RSS":
            rss.append(int(values[0]))
        elif kind == "TEMP":
            temp[values[0]] = int(values[1]) * 512
        elif kind == "OPEN":
            opened[values[0]] = int(values[1]) * 512
    assert wal is not None and rss, "Actual PostgreSQL resource receipt missing"
    return {"postgresOriginalDatabaseIncludingTempAllocatedBytes": db, "postgresWalAllocatedBytes": wal, "postgresTempVisibleAllocatedBytes": sum(temp.values()), "postgresOpenUnlinkedAllocatedBytes": sum(opened.values()), "postgresProcessRssSumBytes": sum(rss), "postgresProcesses": len(rss)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--verify-interruptions", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    scenario = os.environ.get("CS_OBSERVABILITY_SCALE_MODE")
    source = os.environ.get("CS_OBSERVABILITY_SCALE_SHA", "")
    assert scenario in ("full-report", "self-total") and re.fullmatch(r"[a-f0-9]{40}", source)
    assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip() == source
    assert sys.platform == "linux" and Path("/proc/self/fd").is_dir() and Path("/usr/bin/time").is_file()
    directory = Path(args.output).resolve()
    if args.verify_interruptions:
        return interruption_control(directory, source)
    container = os.environ["CS_OBSERVABILITY_SCALE_POSTGRES_CONTAINER"]
    assert re.fullmatch(r"[a-f0-9]{12,64}", container), "Only the actual dedicated service container is measured"
    directory.mkdir(parents=True)
    env = {**os.environ, "CS_OBSERVABILITY_SCALE_OUTPUT": str(directory / "case")}
    started, child, maximum, samples, minimum_free = time.monotonic(), None, {}, 0, None
    receipt = {"sourceSha": source, "scenario": scenario, "records": 10000000, "taskCount": 100000 if scenario == "full-report" else 0, "syntheticValidationOnly": True, "supplierInvoice": False, "sampleIntervalSeconds": 5, "diskPeakKind": "sampled maximum including actual open unlinked files", "bunPeakRssSource": "process-time.txt GNU time maximum resident set size", "postgresMemorySource": "separate actual PostgreSQL VmRSS sum, shared pages may be counted by multiple processes", "postgresContainer": container, "verdict": "FAIL"}
    def interrupted(number, _):
        raise InterruptedError("Owned scale observer signal " + str(number))
    signal.signal(signal.SIGTERM, interrupted)
    try:
        with (directory / "qualification.log").open("x", buffering=1) as log, (directory / "resource-samples.jsonl").open("x", buffering=1) as measurements:
            child = subprocess.Popen(["/usr/bin/time", "-v", "-o", str(directory / "process-time.txt"), "bun", "modules/platform/tests/observability-scale/qualifyRuntimePopulation.ts"], cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            log_position = 0
            while True:
                sample_started = time.monotonic()
                sample = {"elapsedSeconds": time.monotonic() - started, **bun_disk(directory, child.pid), **postgres_sample(container, directory), "rootFreeBytes": shutil.disk_usage(directory).free}
                measurements.write(json.dumps(sample) + "\n"); samples += 1
                with (directory / "qualification.log").open() as progress:
                    progress.seek(log_position)
                    update = progress.read(65536)
                    log_position = progress.tell()
                    if update:
                        print(update, end="", flush=True)
                for key, value in sample.items():
                    if key.endswith("Bytes") and key != "rootFreeBytes":
                        maximum[key] = max(maximum.get(key, 0), value)
                minimum_free = sample["rootFreeBytes"] if minimum_free is None else min(minimum_free, sample["rootFreeBytes"])
                try:
                    receipt["processExitCode"] = child.wait(timeout=max(0.001, 5 - (time.monotonic() - sample_started)))
                    break
                except subprocess.TimeoutExpired:
                    continue
        qualification = json.loads((directory / "case/qualification.json").read_text())
        assert qualification["sourceSha"] == source and qualification["scenario"] == scenario
        expected = {"tasks": "100000", "attempts": "100000", "usage": "10000000"} if scenario == "full-report" else {"selfTotals": "10000000", "groups": "1"}
        assert qualification.get("population") == expected
        receipt["verdict"] = "PASS" if receipt["processExitCode"] == 0 and qualification["state"] == "passed" else "FAIL"
    except BaseException as error:
        receipt["error"] = str(error)
        if child is not None and child.poll() is None:
            receipt["processExitCode"] = stop_measured(child)
        raise
    finally:
        receipt.update({"elapsedSeconds": time.monotonic() - started, "samples": samples, "sampledMaxima": maximum, "minimumObservedRootFreeBytes": minimum_free, "finishedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()})
        (directory / "observer.json").write_text(json.dumps(receipt, indent=2) + "\n")
        print(json.dumps(receipt), flush=True)
    return 0 if receipt["verdict"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
