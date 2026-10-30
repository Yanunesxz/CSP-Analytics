/**
 * Limite de erro por rota: uma tela que quebra não derruba a casca.
 * Mostra "Não deu para abrir esta tela" com "Tentar de novo" (remonta a rota).
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Vazio } from '../ui/Vazio';

interface Props {
  children: ReactNode;
  /** Mude a chave para remontar (a App usa o pathname). */
  chave?: string;
}

interface Estado {
  erro: Error | null;
}

export class LimiteDeErro extends Component<Props, Estado> {
  state: Estado = { erro: null };

  static getDerivedStateFromError(erro: Error): Estado {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo): void {
    // Sem dado pessoal no log: só a mensagem e a pilha de componentes
    console.error('Tela quebrou:', erro.message, info.componentStack);
  }

  componentDidUpdate(anterior: Props): void {
    if (anterior.chave !== this.props.chave && this.state.erro) this.setState({ erro: null });
  }

  render(): ReactNode {
    if (this.state.erro) {
      return (
        <Vazio
          erro
          titulo="Não deu para abrir esta tela"
          texto="Algo quebrou ao desenhar a tela. Tente de novo; se continuar, avise o suporte com o código."
          codigo="UI-500"
          aoTentarDeNovo={() => this.setState({ erro: null })}
        />
      );
    }
    return this.props.children;
  }
}
