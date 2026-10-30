/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SAMPLE_DATA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Definidos em `vite.config.ts` na build. */
declare const __APP_VERSION__: string;
declare const __APP_BUILT_AT__: string;

/** `ui/diagnostico.js` do padrão, carregado pelo módulo Diagnóstico. */
interface YNDiagnosticoOpcoes {
  perfil: { publico: boolean; vende: boolean; rastreamento: boolean; dadosPessoais: boolean };
  paginas: string[];
  larguras?: number[];
  esperar?: number;
}

interface Window {
  YNDiagnostico?: {
    versao: string;
    montar: (el: HTMLElement, opcoes: YNDiagnosticoOpcoes) => void;
  };
}
