/**
 * Uma seção de Configurações no molde do formulário longo do padrão (.yn-form-section): título e frase à
 * esquerda, controles à direita; empilha abaixo de 720px de área. O `id` serve de âncora
 * (`/configuracoes#avisos`).
 */

import type { ReactNode } from 'react';

export interface SecaoProps {
  id: string;
  titulo: string;
  descricao: string;
  children: ReactNode;
}

export function Secao({ id, titulo, descricao, children }: SecaoProps) {
  const idTitulo = `${id}-titulo`;
  return (
    <section className="yn-form-section" id={id} aria-labelledby={idTitulo}>
      <div className="yn-form-section__intro">
        <h2 id={idTitulo}>{titulo}</h2>
        <p>{descricao}</p>
      </div>
      <div className="grid min-w-0 content-start gap-3">{children}</div>
    </section>
  );
}
