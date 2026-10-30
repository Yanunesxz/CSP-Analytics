import { Monitor, Moon, Sun } from 'lucide-react';
import { PageHeader } from '../../components/layout/pagina';
import { EmConstrucao } from '../../components/ui/EmConstrucao';
import { useTema, type Tema } from '../../lib/tema';

const TEMAS: Array<{ valor: Tema; rotulo: string; icone: typeof Monitor }> = [
  { valor: '', rotulo: 'Aparelho', icone: Monitor },
  { valor: 'light', rotulo: 'Claro', icone: Sun },
  { valor: 'dark', rotulo: 'Escuro', icone: Moon },
];

export default function Configuracoes() {
  const { preferencia, definir } = useTema();
  return (
    <>
      <PageHeader grupo="Sistema" titulo="Configurações" />
      <section className="yn-card mkt-stack" aria-labelledby="config-tema">
        <h2 id="config-tema">Tema</h2>
        <div className="yn-segmented" role="group" aria-label="Tema">
          {TEMAS.map((t) => (
            <button
              key={t.valor}
              type="button"
              aria-pressed={preferencia === t.valor}
              onClick={() => definir(t.valor)}
            >
              <t.icone strokeWidth={1.75} aria-hidden="true" />
              {t.rotulo}
            </button>
          ))}
        </div>
        <p className="yn-muted text-sm">A escolha fica guardada neste navegador.</p>
      </section>
      <EmConstrucao oQueVaiTer="Avisos: o que você recebe e por qual canal." />
    </>
  );
}
