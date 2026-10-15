import { classHighlighter } from '@lezer/highlight';

// Use stable tok-* classes and style them in CSS so code highlighting stays
// explicit, themeable, and consistent across text/markdown editors.
export const editorSyntaxHighlighter = classHighlighter;
