import type { IBuffer, IBufferCell, IBufferLine, IBufferNamespace, Terminal } from '@xterm/headless';

/** 缩窄后 xterm 行容量可能保留旧宽度；序列化只能读取当前屏幕内的列。 */
export function terminalSnapshotView(terminal: Terminal): Terminal {
  return new Proxy(terminal, {
    get(target, key) {
      if (key === 'buffer') return visibleBuffers(target.buffer, target.cols);
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function visibleBuffers(buffers: IBufferNamespace, cols: number): IBufferNamespace {
  const normal = visibleBuffer(buffers.normal, cols), alternate = visibleBuffer(buffers.alternate, cols);
  return { normal, alternate, active: buffers.active.type === 'normal' ? normal : alternate, onBufferChange: buffers.onBufferChange.bind(buffers) };
}

function visibleBuffer(buffer: IBuffer, cols: number): IBuffer {
  return {
    type: buffer.type, cursorX: buffer.cursorX, cursorY: buffer.cursorY,
    viewportY: buffer.viewportY, baseY: buffer.baseY, length: buffer.length,
    getNullCell: () => buffer.getNullCell(),
    getLine: (row) => {
      const line = buffer.getLine(row);
      return line ? visibleLine(line, cols) : undefined;
    },
  };
}

function visibleLine(line: IBufferLine, cols: number): IBufferLine {
  const length = Math.min(line.length, cols);
  return {
    isWrapped: line.isWrapped, length,
    getCell: (column, cell) => {
      if (column >= length) return undefined;
      const value = line.getCell(column, cell);
      // 半个宽字符不能写进窄终端，否则会自动换行。独立 cell 保留原样式，也不破坏 addon 的复用身份。
      return value?.getWidth() === 2 && column + 2 > length ? blankCell(line.getCell(column)!) : value;
    },
    translateToString: (trimRight, start, end) => {
      const last = Math.min(end ?? length, length);
      const clipped = last === length && (start ?? 0) < last && line.getCell(last - 1)?.getWidth() === 2;
      const text = line.translateToString(false, start, last - Number(clipped)) + (clipped ? ' ' : '');
      return trimRight ? text.trimEnd() : text;
    },
  };
}

function blankCell(cell: IBufferCell): IBufferCell {
  return new Proxy(cell, {
    get(target, key) {
      if (key === 'getChars') return () => ' ';
      if (key === 'getWidth') return () => 1;
      if (key === 'getCode') return () => 32;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
