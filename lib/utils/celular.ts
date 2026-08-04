/**
 * Gera variantes de um número de celular brasileiro para buscas tolerantes a formato.
 *
 * Lida com: código de país 55, dígito 9 transitório (DDD + 8 ou 9 dígitos locais),
 * e números sem código de país. Retorna até 6 formas possíveis sem duplicatas.
 */
export function celularVariantes(celular: string): string[] {
  const d = celular.replace(/\D/g, '')
  const variants = new Set([d])

  let sem55 = d
  if (d.startsWith('55') && d.length >= 12) {
    sem55 = d.slice(2)
    variants.add(sem55)
  }

  // 10 dígitos sem país = DDD + 8 locais → adiciona 9 transitório
  if (sem55.length === 10) {
    const com9 = sem55.slice(0, 2) + '9' + sem55.slice(2)
    variants.add(com9)
    variants.add('55' + com9)
  }

  // 11 dígitos sem país = DDD + 9 locais → remove 9 transitório
  if (sem55.length === 11 && sem55[2] === '9') {
    const sem9 = sem55.slice(0, 2) + sem55.slice(3)
    variants.add(sem9)
    variants.add('55' + sem9)
  }

  return [...variants]
}
