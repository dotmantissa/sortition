"""Keep one reviewed proof implementation embedded in pinned single-file ICs."""
from pathlib import Path
shared = Path('contracts/shared/studio_proof.py').read_text()
for name in ('sortition_docket', 'settlement_vault'):
    p = Path('contracts') / (name + '.py')
    text = p.read_text()
    begin, end = '# BEGIN STUDIO RECEIPT PROOF\n', '# END STUDIO RECEIPT PROOF\n'
    block = begin + shared + end
    if begin in text:
        a, rest = text.split(begin, 1)
        _, b = rest.split(end, 1)
        text = a + block + b
    else:
        at = text.index('\n\n', text.index('from datetime'))
        text = text[:at] + '\n\n' + block + text[at:]
    p.write_text(text)
