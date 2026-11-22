import portraits from '@/lib/vendor/munder-portraits.json';
import { castFor } from '@/lib/munder-cast';
/** MIT-licensed procedural cast art from Munder Difflin; see public/vendor/munder/LICENSE. */
export default function CharacterFace({ face, size = 40 }: { face?: string | null; size?: number }) {
  return <img src={portraits[castFor(face)]} width={size} height={size} alt="Agent character" style={{ imageRendering: 'pixelated', objectFit: 'contain', background: '#f1ece2', borderRadius: 8 }} />;
}
