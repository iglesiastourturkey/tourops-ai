// Type declarations for pdfmake font bundles (no official types provided)
declare module 'pdfmake/build/fonts/Roboto' {
  import type { TVirtualFileSystem, TFontDictionary } from 'pdfmake/interfaces';
  const fontContainer: { vfs: TVirtualFileSystem; fonts: TFontDictionary };
  export default fontContainer;
  export = fontContainer;
}
