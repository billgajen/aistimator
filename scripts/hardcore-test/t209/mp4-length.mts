// T-209: how long an MP4 says it is, read from the file's own header (moov > mvhd). No decoder is
// needed, so the checks can hold a guide's `seconds` to its file without a video tool installed.

interface Box {
  type: string
  start: number
  end: number
}

function boxes(file: Buffer, from: number, to: number): Box[] {
  const found: Box[] = []
  let at = from
  while (at + 8 <= to) {
    let size = file.readUInt32BE(at)
    let head = 8
    if (size === 1) {
      size = Number(file.readBigUInt64BE(at + 8))
      head = 16
    } else if (size === 0) size = to - at
    if (size < head) break
    found.push({ type: file.toString('latin1', at + 4, at + 8), start: at + head, end: Math.min(at + size, to) })
    at += size
  }
  return found
}

/** The length in seconds, or null when the bytes are not an MP4 with a movie header */
export function mp4Seconds(file: Buffer): number | null {
  const moov = boxes(file, 0, file.length).find((b) => b.type === 'moov')
  const mvhd = moov && boxes(file, moov.start, moov.end).find((b) => b.type === 'mvhd')
  if (!mvhd) return null
  const long = file[mvhd.start] === 1
  const scale = file.readUInt32BE(mvhd.start + (long ? 20 : 12))
  const length = long ? Number(file.readBigUInt64BE(mvhd.start + 24)) : file.readUInt32BE(mvhd.start + 16)
  return scale > 0 ? length / scale : null
}
