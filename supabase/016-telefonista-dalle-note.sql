-- 05/11/2026 — telefonista ricavata dalle note degli eventi Google («Cognome I.» o nome e cognome): va nel report (Davide).
-- Solo righe arrivate da Google senza telefonista; attribuita solo se nelle note c'è UNA sola telefonista riconoscibile.
with tel(id, rx) as (values (2, '(?:\mRossella\s*G\.?(?![[:alpha:]]))|(?:\mGatto\s*R\.?(?![[:alpha:]]))|(?:\mRossella\s+Gatto\M)|(?:\mGatto\s+Rossella\M)'),
  (3, '(?:\mFrancesca\s*I\.?(?![[:alpha:]]))|(?:\mIuliano\s*F\.?(?![[:alpha:]]))|(?:\mFrancesca\s+Iuliano\M)|(?:\mIuliano\s+Francesca\M)'),
  (4, '(?:\mGiovanna\s*M\.?(?![[:alpha:]]))|(?:\mMonti\s*G\.?(?![[:alpha:]]))|(?:\mGiovanna\s+Monti\M)|(?:\mMonti\s+Giovanna\M)'),
  (5, '(?:\mDonatella\s*C\.?(?![[:alpha:]]))|(?:\mCarletti\s*D\.?(?![[:alpha:]]))|(?:\mDonatella\s+Carletti\M)|(?:\mCarletti\s+Donatella\M)'),
  (6, '(?:\mMoira\s*G\.?(?![[:alpha:]]))|(?:\mGanassin\s*M\.?(?![[:alpha:]]))|(?:\mMoira\s+Ganassin\M)|(?:\mGanassin\s+Moira\M)'),
  (7, '(?:\mMargherita\s*R\.?(?![[:alpha:]]))|(?:\mRacano\s*M\.?(?![[:alpha:]]))|(?:\mMargherita\s+Racano\M)|(?:\mRacano\s+Margherita\M)'),
  (8, '(?:\mTeresa\s*Z\.?(?![[:alpha:]]))|(?:\mZordan\s*T\.?(?![[:alpha:]]))|(?:\mTeresa\s+Zordan\M)|(?:\mZordan\s+Teresa\M)'),
  (9, '(?:\mTavilla\s*B\.?(?![[:alpha:]]))|(?:\mBarbara\s*T\.?(?![[:alpha:]]))|(?:\mTavilla\s+Barbara\M)|(?:\mBarbara\s+Tavilla\M)'),
  (10, '(?:\mFlavia\s*R\.?(?![[:alpha:]]))|(?:\mRosa\s*F\.?(?![[:alpha:]]))|(?:\mFlavia\s+Maria\s+Rosa\M)|(?:\mRosa\s+Maria\s+Flavia\M)'),
  (11, '(?:\mMesiano\s*E\.?(?![[:alpha:]]))|(?:\mElena\s*M\.?(?![[:alpha:]]))|(?:\mMesiano\s+Elena\M)|(?:\mElena\s+Mesiano\M)'),
  (12, '(?:\mIrene\s*M\.?(?![[:alpha:]]))|(?:\mMolina\s*I\.?(?![[:alpha:]]))|(?:\mIrene\s+Molina\M)|(?:\mMolina\s+Irene\M)'),
  (13, '(?:\mSara\s*B\.?(?![[:alpha:]]))|(?:\mBarbato\s*S\.?(?![[:alpha:]]))|(?:\mSara\s+Barbato\M)|(?:\mBarbato\s+Sara\M)'),
  (14, '(?:\mElena\s*F\.?(?![[:alpha:]]))|(?:\mFranco\s*E\.?(?![[:alpha:]]))|(?:\mElena\s+Franco\M)|(?:\mFranco\s+Elena\M)'),
  (15, '(?:\mMartha\s*M\.?(?![[:alpha:]]))|(?:\mMartinelli\s*M\.?(?![[:alpha:]]))|(?:\mMartha\s+Martinelli\M)|(?:\mMartinelli\s+Martha\M)'),
  (16, '(?:\mLuana\s*P\.?(?![[:alpha:]]))|(?:\mPrestifilippo\s*L\.?(?![[:alpha:]]))|(?:\mLuana\s+Prestifilippo\M)|(?:\mPrestifilippo\s+Luana\M)')),
m as (select r.id as rid, t.id as tid from cc_registrazioni r join tel t on (coalesce(r.note,'') || ' ' || coalesce(r.cliente,'')) ~* t.rx
      where r.google_event_id is not null and r.operatrice_id is null and r.tipo_codice like 'app_%'),
uno as (select rid, min(tid) as tid from m group by rid having count(distinct tid) = 1)
update cc_registrazioni r set operatrice_id = uno.tid, google_sync_at = now() from uno where r.id = uno.rid;
