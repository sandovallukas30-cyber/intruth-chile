// lexical-features.js — InTruth Chile
// Extrae características léxicas del discurso para análisis de convicción.

const EXCLUSIVE_WORDS = new Set([
  'pero', 'excepto', 'sin', 'excluir', 'excluyendo', 'sin embargo',
  'aunque', 'salvo', 'a pesar', 'en cambio', 'no obstante',
  'mientras que', 'a menos que'
]);

const HEDGING_WORDS = new Set([
  'quizás', 'tal vez', 'posiblemente', 'probablemente', 'podría',
  'parece', 'aparentemente', 'aproximadamente', 'alrededor', 'más o menos',
  'creo', 'pienso', 'supongo', 'no estoy seguro', 'a lo mejor',
  'puede que', 'según dicen', 'supuestamente', 'presuntamente'
]);

const CERTAINTY_WORDS = new Set([
  'siempre', 'nunca', 'definitivamente', 'ciertamente', 'absolutamente',
  'claramente', 'obviamente', 'sin duda', 'comprobado', 'demostrado',
  'evidentemente', 'estadísticas', 'porcentaje', 'datos', 'estudio',
  'todo', 'nada', 'garantizado', 'hecho'
]);

const EMOTIONAL_WORDS = new Set([
  'terrible', 'horrible', 'desastre', 'catástrofe', 'fantástico',
  'increíble', 'nefasto', 'vergonzoso', 'inaceptable', 'indignante',
  'ridículo', 'patético', 'brillante', 'estúpido', 'corrupto',
  'amor', 'odio', 'miedo', 'rabia', 'orgullo'
]);

const FILLER_WORDS = new Set([
  'eh', 'este', 'eee', 'o sea', 'básicamente', 'literalmente',
  'bueno', 'okay', 'a ver', 'entonces', 'digamos', 'mira',
  'en fin', 'ya', 'claro'
]);

const FIRST_PERSON_SINGULAR = new Set([
  'yo', 'me', 'mi', 'mío', 'mía', 'mismo', 'misma'
]);

const FIRST_PERSON_PLURAL = new Set([
  'nosotros', 'nos', 'nuestro', 'nuestra', 'nuestros', 'nuestras'
]);

const THIRD_PERSON = new Set([
  'él', 'ella', 'ellos', 'ellas', 'le', 'les', 'su', 'sus',
  'su', 'suyo', 'suya'
]);

function extractLexicalFeatures(text, durationSeconds) {
  const lower = text.toLowerCase();
  const words = lower.match(/\b\w+\b/g) || [];
  const wordCount = words.length;

  if (wordCount === 0) return null;

  let exclusiveCount  = 0;
  let hedgingCount    = 0;
  let certaintyCount  = 0;
  let emotionalCount  = 0;
  let fillerCount     = 0;
  let firstPersonSing = 0;
  let firstPersonPlur = 0;
  let thirdPerson     = 0;

  for (const word of words) {
    if (EXCLUSIVE_WORDS.has(word))        exclusiveCount++;
    if (HEDGING_WORDS.has(word))          hedgingCount++;
    if (CERTAINTY_WORDS.has(word))        certaintyCount++;
    if (EMOTIONAL_WORDS.has(word))        emotionalCount++;
    if (FILLER_WORDS.has(word))           fillerCount++;
    if (FIRST_PERSON_SINGULAR.has(word))  firstPersonSing++;
    if (FIRST_PERSON_PLURAL.has(word))    firstPersonPlur++;
    if (THIRD_PERSON.has(word))           thirdPerson++;
  }

  // frases multi-palabra
  if (lower.includes('creo que'))      hedgingCount++;
  if (lower.includes('pienso que'))    hedgingCount++;
  if (lower.includes('tal vez'))       hedgingCount++;
  if (lower.includes('quizás'))        hedgingCount++;
  if (lower.includes('o sea'))         fillerCount++;
  if (lower.includes('a ver'))         fillerCount++;

  const per100 = (n) => parseFloat(((n / wordCount) * 100).toFixed(1));

  const wordsPerSecond = durationSeconds && durationSeconds > 0
    ? parseFloat((wordCount / durationSeconds).toFixed(1))
    : null;

  const avgWordLength = parseFloat(
    (words.reduce((sum, w) => sum + w.length, 0) / wordCount).toFixed(1)
  );

  const commitmentScore = parseFloat((
    (certaintyCount * 0.3)
    + (firstPersonSing * 0.15)
    - (hedgingCount * 0.4)
    - (fillerCount * 0.25)
    - (emotionalCount * 0.1)
    + (exclusiveCount * 0.1)
  ).toFixed(2));

  const commitmentLabel =
    commitmentScore >  0.3 ? 'HIGH'   :
    commitmentScore < -0.3 ? 'LOW'    :
                             'MEDIUM';

  return {
    wordCount,
    wordsPerSecond,
    avgWordLength,
    rates: {
      hedging:       per100(hedgingCount),
      certainty:     per100(certaintyCount),
      emotional:     per100(emotionalCount),
      filler:        per100(fillerCount),
      exclusive:     per100(exclusiveCount),
      firstPersonSg: per100(firstPersonSing),
      firstPersonPl: per100(firstPersonPlur),
      thirdPerson:   per100(thirdPerson),
    },
    commitmentScore,
    commitmentLabel,
    summary: buildSummary({
      wordCount, wordsPerSecond, hedgingCount, certaintyCount,
      emotionalCount, fillerCount, exclusiveCount,
      firstPersonSing, firstPersonPlur, commitmentLabel
    })
  };
}

function buildSummary({ wordCount, wordsPerSecond, hedgingCount, certaintyCount,
  emotionalCount, fillerCount, exclusiveCount, firstPersonSing,
  firstPersonPlur, commitmentLabel }) {

  const parts = [];

  if (wordsPerSecond !== null) {
    const rateDesc = wordsPerSecond > 3.5 ? 'rápido' : wordsPerSecond < 2 ? 'lento' : 'moderado';
    parts.push(`velocidad de habla: ${wordsPerSecond} palabras/seg (${rateDesc})`);
  }

  if (hedgingCount > 0)
    parts.push(`${hedgingCount} expresión${hedgingCount > 1 ? 'es' : ''} dubitativa${hedgingCount > 1 ? 's' : ''} (ej. "quizás", "creo que")`);
  if (fillerCount > 0)
    parts.push(`${fillerCount} muletilla${fillerCount > 1 ? 's' : ''} (ej. "eh", "o sea")`);
  if (certaintyCount > 0)
    parts.push(`${certaintyCount} marcador${certaintyCount > 1 ? 'es' : ''} de certeza (ej. "siempre", "definitivamente", estadísticas)`);
  if (emotionalCount > 0)
    parts.push(`${emotionalCount} palabra${emotionalCount > 1 ? 's' : ''} emocional${emotionalCount > 1 ? 'es' : ''}`);
  if (exclusiveCount > 0)
    parts.push(`${exclusiveCount} palabra${exclusiveCount > 1 ? 's' : ''} calificadora${exclusiveCount > 1 ? 's' : ''} (ej. "pero", "excepto")`);
  if (firstPersonSing > 0)
    parts.push(`${firstPersonSing} pronombre${firstPersonSing > 1 ? 's' : ''} en primera persona singular (yo/me/mi)`);
  if (firstPersonPlur > 0)
    parts.push(`${firstPersonPlur} pronombre${firstPersonPlur > 1 ? 's' : ''} en primera persona plural (nosotros/nuestro)`);

  return parts.length
    ? `Características léxicas: ${parts.join(', ')}. Convicción general: ${commitmentLabel}.`
    : `Sin señales de convicción marcadas. Convicción general: ${commitmentLabel}.`;
}
