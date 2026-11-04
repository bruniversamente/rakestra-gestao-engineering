# Evidências com o alcance identificado

O pacote técnico desta apresentação reúne oito módulos executáveis extraídos do produto e cinco arquivos de referência do backend. As adaptações dos módulos executáveis são de caminhos de importação; o manifesto registra os arquivos de origem e seus hashes.

Os 24 testes passaram localmente com Node.js 24.14.0 em 4 de novembro de 2026. O leitor pode executar os mesmos cenários sem instalar dependências, acessar contas ou conectar um banco de dados.

| Verificação | Evidência | Alcance |
| --- | --- | --- |
| Agenda e tempo | 8 cenários de ocupação, sobreposição, fuso e limite de horário. | Funções compartilhadas, em memória. |
| Acesso e contexto | 7 cenários de função, liberação, unidade e navegação. | Política de rota; não substitui os testes da autorização da API. |
| Cotação e cobrança | 9 cenários de valores, contexto, origem e respostas divergentes. | Contratos e leitores; sem movimentação financeira. |
| Backend | Código de referência da ocupação, confirmação, acesso e recuperação. | Não executado pelo pacote público. |
| Apresentação | Capturas de desenvolvimento, mapa e exemplos interativos. | Mostram interfaces e regras selecionadas; não certificam o produto completo. |

A edição usa a execução de TypeScript do Node para verificar comportamento. A validação completa do produto inclui banco, integrações e percursos na interface, além da verificação estática de tipos e dos builds pertinentes. As evidências desta edição não são uma declaração de prontidão para produção.
