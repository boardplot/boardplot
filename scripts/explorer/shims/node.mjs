/** File and path functions are unreachable for object specs without outDir/rowsFile. */
function unavailable(){throw new Error('File access is not available in the explorer');}
export { unavailable as mkdirSync, unavailable as readdirSync, unavailable as statSync,
  unavailable as writeFileSync, unavailable as readFileSync, unavailable as realpathSync,
  unavailable as basename, unavailable as dirname, unavailable as extname,
  unavailable as isAbsolute, unavailable as join, unavailable as resolve,
  unavailable as closeSync, unavailable as openSync, unavailable as lstatSync };
export const constants = {};
