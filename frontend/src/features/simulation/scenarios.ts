import type { Risk } from '../../hooks/useSpeech'
import type { Detection, DetectResult } from '../ai/detect'

export interface Scenario {
  id: string
  name: string
  description: string
  detections: Detection[]
  text: string
  highest: Risk | null
}

const d = (
  label: string,
  risk: Risk,
  position: Detection['position'],
  box: Detection['box'],
  confidence: number,
  announcement: string,
): Detection => ({ label, risk, position, box, confidence, announcement })

/** Canned, clearly simulated inputs. They never go to the detector and are never stored as live data. */
export const SCENARIOS: Scenario[] = [
  {
    id: 'crowded',
    name: 'Crowded footpath',
    description: 'Several people around you, one directly ahead.',
    detections: [
      d('person', 'high', 'ahead', { x: 0.4, y: 0.25, w: 0.22, h: 0.7 }, 0.91, 'Simulated: person ahead.'),
      d('person', 'medium', 'left', { x: 0.05, y: 0.3, w: 0.15, h: 0.55 }, 0.84, 'Simulated: person on your left.'),
      d('person', 'low', 'right', { x: 0.8, y: 0.4, w: 0.1, h: 0.35 }, 0.77, 'Simulated: person on your right.'),
    ],
    text: 'Simulated: person ahead.',
    highest: 'high',
  },
  {
    id: 'vehicle',
    name: 'Vehicle approaching',
    description: 'A car close ahead and getting closer.',
    detections: [d('car', 'critical', 'ahead', { x: 0.25, y: 0.3, w: 0.5, h: 0.6 }, 0.93, 'Simulated: vehicle ahead, getting closer.')],
    text: 'Simulated: vehicle ahead, getting closer.',
    highest: 'critical',
  },
  {
    id: 'clear',
    name: 'Clear path',
    description: 'Nothing detected in front of you.',
    detections: [],
    text: 'Simulated: no objects in this scenario.',
    highest: null,
  },
  {
    id: 'left',
    name: 'Obstacle on left',
    description: 'A bench on the left side of the path.',
    detections: [d('bench', 'medium', 'left', { x: 0.05, y: 0.5, w: 0.3, h: 0.3 }, 0.82, 'Simulated: obstacle on your left.')],
    text: 'Simulated: obstacle on your left.',
    highest: 'medium',
  },
]

/** Shapes a scenario like a detector response so the same UI renders it; the model field says it is simulated. */
export function scenarioResult(s: Scenario): DetectResult {
  return {
    detections: s.detections,
    summary: { text: s.text, highest_risk: s.highest },
    image: { width: 640, height: 480 },
    inference_ms: 0,
    source: 'simulation',
    model: 'simulated-scenario',
  }
}
