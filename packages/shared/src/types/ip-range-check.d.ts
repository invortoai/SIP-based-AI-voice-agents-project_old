declare module 'ip-range-check' {
  function ipRangeCheck(ip: string, ranges: string[] | string): boolean;
  export default ipRangeCheck;
}