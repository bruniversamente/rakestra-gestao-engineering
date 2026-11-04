# Identificação e recuperação de operações

## Situação

Uma operação pode ser repetida ou perder sua confirmação; reutilizar uma identidade para outro conteúdo compromete o significado do resultado.

## Escolha na implementação

O backend associa clube, chave, tipo e conteúdo ao resultado da operação. O fluxo de configuração confere o autor, a revisão e o recurso ao recuperar a confirmação.

## Consequências

A mesma chave conserva o mesmo significado. Conteúdo divergente gera conflito, e a consulta de recuperação exige novamente o contexto autorizado.

## Código

- [reference/idempotent-command.ts](../../reference/idempotent-command.ts)
- [reference/facility-command-recovery.ts](../../reference/facility-command-recovery.ts)

## Verificação desta edição

Este pacote disponibiliza o código inalterado para consulta. Não executa a recuperação do servidor com banco e interface; o diagrama do portfólio é explicativo.
