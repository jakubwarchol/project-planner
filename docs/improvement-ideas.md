# Pomysły na ulepszenie modelu planowania

Zebrane z oceny przydatności modelu do planowania pracy zespołu na kilka miesięcy
naprzód (sierpień 2026). Kolejność w każdej sekcji odzwierciedla priorytet.

## Kontekst: do czego model się nadaje

Horyzont 2–6 miesięcy to jego strefa — tam o wyniku decyduje arytmetyka pojemności
(ilu ludzi, ile nakładu, w jakiej kolejności, gdzie wąskie gardło), a to jest
dokładnie to, co scheduler liczy. Poniżej miesiąca potrzebne jest planowanie
zadań (Jira), powyżej roku wyceny są zbyt spekulatywne.

Znane granice uczciwości modelu:

- **Nie śledzi postępu** — wyceny to całkowity nakład; model nie wie, że projekt
  jest w połowie zrobiony. Bez regularnej aktualizacji plan odjeżdża od
  rzeczywistości.
- **Daty są punktowe** — brak przedziałów niepewności; realny błąd wycen na tym
  horyzoncie to ±20–30%.
- **Pula zakłada wymienność ludzi** w ramach kompetencji; „tylko Kasia zna ten
  system" wychodzi dopiero w Obsadzie jako luka i celowo nie przesuwa dat.
- **Liniowość** — zaniżone wyceny/produktywność przesuwają wszystkie daty o ten
  sam procent; żadna matematyka tego nie naprawi.

## Ulepszenia duże (największa dźwignia)

### 1. Pozostały nakład („ile zostało dni")

Pole „pozostało dni" (albo % ukończenia) obok wyceny, z którego scheduler liczy
zamiast z pełnego nakładu. Zamienia rytuał odświeżania planu z ręcznego
przepisywania macierzy w minutę pracy. To warunek używania modelu *na bieżąco*,
a nie tylko do jednorazowego planowania.

### 2. Zespół zmienny w czasie (zatrudnienia i odejścia)

Dziś zespół jest stały na całym horyzoncie, a planując do grudnia zwykle
*wiadomo*, że ktoś odchodzi we wrześniu, a nowa osoba zaczyna w październiku.

- Daty zatrudnienia/odejścia na `Person`.
- **Krzywa wdrożenia** dla nowych: np. 40% produktywności w pierwszym miesiącu,
  70% w drugim. Bez tego symulacja „zatrudnijmy BE" jest zawsze zbyt
  optymistyczna — czyli kłamie dokładnie w tej decyzji, do której najczęściej
  się jej używa.

Technicznie tanie: `lib/leaves.ts` już wcina zakresy dat w miesięczne pule —
okres przed zatrudnieniem i po odejściu to ten sam mechanizm, ramp-up to
współczynnik zamiast zera.

### 3. Praca stała (utrzymanie, wsparcie, BAU)

Zespoły nie pracują w 100% nad projektami z backlogu. Dziś strukturalną pracę
ciągłą można tylko sfałszować zaniżoną produktywnością albo wiecznym
pseudo-projektem. Pierwszoklasowa **stała rezerwacja** (np. „1,5 FTE BE ciągle
na utrzymanie X") jawnie pomniejsza pule, a produktywność zostaje tym, czym
jest (spotkania, kontekst). Mechanizm ten sam co urlopy, tylko bez daty końca.

### 4. Pamięć planu: snapshoty i kalibracja

Zapisywać snapshot wyliczonego planu (co tydzień / przy każdej zmianie — SQLite
już jest, to jedna tabela). Daje dwie rzeczy naraz:

- **Diff planu** — „co się przesunęło od zeszłego miesiąca i przez co" (zmiana
  wyceny? urlop? projekt wepchnięty wyżej?). Na kilkumiesięcznym horyzoncie to
  pytanie pada częściej niż „kiedy koniec".
- **Kalibracja** — po kilku zakończonych projektach porównanie przewidywanych
  dat z faktycznymi pokazuje, czy wyceny są systematycznie zaniżone i o ile.
  Ten mnożnik to najuczciwszy sposób poprawienia wszystkich przyszłych dat
  naraz.

Wartość rośnie z czasem — opłaca się zacząć zbierać wcześnie, nawet zanim
powstanie UI do przeglądania.

### 5. Niepewność wycen

Mnożniki optymistyczny/pesymistyczny (np. ±25%, ewentualnie sterowane
oznaczeniem pewności wyceny) renderowane jako przedziały dat na osi zamiast
punktów. Tanie w implementacji, duży zysk uczciwości. Pesymistyczny scenariusz
można też trzymać jako wariant w Symulacjach.

### 6. Optymalizator kolejności

Scheduler jest deterministyczny przy zadanej kolejności backlogu — więc można ją
przeszukiwać. Przycisk „zaproponuj kolejność" minimalizujący liczbę
niedotrzymanych deadline'ów (albo ważone opóźnienie) zamienia ręczne
przeciąganie projektów metodą prób i błędów w jedną sugestię do zaakceptowania.
Filozofia „deadline to fakt, nie wejście" zostaje nienaruszona: deadline'y
byłyby celem optymalizacji kolejności, nie ograniczeniem schedulera.

## Ulepszenia mniejsze

- **Warianty projektowe w Symulacjach** — dziś warianty różnicują tylko zespół;
  drugą połową negocjacji roadmapy jest „a gdybyśmy wycięli projekt X / dodali
  Y". Porównanie zestawów projektów obok zestawów ludzi domknęłoby obraz.
- **Umiejętności ponad kompetencjami** — tagi na ludziach i projektach („zna
  system Z"), żeby dopasowanie kandydatów w Przydziel odróżniało „dowolny FE"
  od „FE, który zna ten kod". Adresuje wymienność ludzi w puli po stronie
  Obsady.
- **Luki obsady widoczne na Planie** — Obsada celowo nie przesuwa dat, ale Plan
  mógłby *pokazywać* (np. kreskowaniem), że odcinek nie ma pokrycia w ludziach:
  plan formalnie wykonalny, personalnie fikcyjny. Ostrzeżenie zamiast
  sprzężenia, zgodnie z obecną architekturą (przypisania nigdy nie wracają do
  schedulera).
- **Widok niewykorzystanej pojemności** — „ile FTE każdej kompetencji leży
  odłogiem w listopadzie". Odpowiada na pytanie odwrotne do zwykłego: nie
  „zdążymy?", tylko „czy stać nas na jeszcze jeden projekt?".

## Sugerowana kolejność wdrażania

1. **Zmienny zespół z ramp-upem** — bez niego Symulacje odpowiadają nieprecyzyjnie
   na swoje główne pytanie, a koszt jest niski.
2. **Snapshoty** — im wcześniej zaczną się zbierać, tym szybciej będzie z czego
   kalibrować.
3. **Pozostały nakład** — gdy model zacznie być używany na bieżąco, a nie do
   jednorazowego planowania.
4. Dalej według potrzeb: praca stała, niepewność, optymalizator, reszta.
