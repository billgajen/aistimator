// T-190: pictures in assets/ are bundled by Metro; an import gives the number React Native's Image takes.
declare module '*.png' {
  const source: number
  export default source
}
