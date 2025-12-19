'use client';

import { useEffect, useRef } from 'react';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import 'highlight.js/styles/atom-one-dark.css';

// Register languages
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);

interface CodeBlockProps {
  code: string;
  language?: 'typescript' | 'javascript';
  title?: string;
  titleColor?: string;
}

export function CodeBlock({ code, language = 'typescript', title, titleColor = 'bg-blue-500' }: CodeBlockProps) {
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (codeRef.current) {
      codeRef.current.removeAttribute('data-highlighted');
      codeRef.current.className = `language-${language} hljs`;
      codeRef.current.textContent = code;
      hljs.highlightElement(codeRef.current);
    }
  }, [code, language]);

  return (
    <div className="mb-6">
      {title && (
        <h3 className="font-semibold text-slate-200 mb-2 flex items-center gap-2">
          <span className={`w-2 h-2 ${titleColor} rounded-full`}></span>
          {title}
        </h3>
      )}
      <div className="bg-[#282c34] border border-slate-700 rounded-lg overflow-hidden">
        <pre className="p-4 overflow-x-auto text-sm m-0">
          <code ref={codeRef} className={`language-${language} hljs`} />
        </pre>
      </div>
    </div>
  );
}
