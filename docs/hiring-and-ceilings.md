# Drugi tryb planera zatrudnienia: etaty razem z sufitami

Notatka projektowa, sierpień 2026. Powstała po wymianie zdań o tym, dlaczego
planer zatrudnienia w Symulacjach przestaje cokolwiek kupować po pierwszej
osobie. Wszystkie liczby poniżej są zmierzone na realnym portfelu (12 projektów
w planie, zespół 14 FTE), nie oszacowane.

Kontekst kodu: `src/lib/hiringPlanner.ts` (tryb 1, gotowy),
`src/lib/autopilot.ts` (istniejący autopilot sufitów w Wycenach),
`src/lib/crew.ts` (dlaczego sufit to nie jest zwykły limit).

## Obserwacja, od której się zaczęło

Planer w obecnym kształcie mówi: zatrudnij jednego UX-a, plan skraca się z 14,0
do 8,9 miesiąca. Druga, trzecia i każda kolejna osoba nie zmienia **nic** —
ladder jest płaski aż do siedmiu etatów.

Powód: po pierwszej osobie plan przestaje być ograniczony liczbą ludzi, a zaczyna
sufitami `maxFte` na projektach. Nowi ludzie nie mają dokąd wejść.

## Dlaczego „tryb bez sufitów" nie działa

Pierwszy pomysł brzmiał: drugi tryb po prostu ignoruje `maxFte`. Zmierzone —
**wszystkie 12 projektów robi się niewykonalnych**.

Sufit w tym modelu nie jest samym limitem. Jest definicją załogi: kompetencja
wyznaczająca tempo pracuje dokładnie na swoim suficie, reszta jest de-ratowana,
żeby skończyć razem z nią (`lib/crew.ts`), a **minimum potrzebne do otwarcia
fazy** to `załoga × minStaffingFraction` (dziś 0,4). Sufit 99 znaczy więc „zanim
cokolwiek ruszy, postaw tu ~40 FTE".

Nie jest to problem tylko skrajnych wartości — próg zapada się szybko i
niemonotonicznie:

| Sufity | Plan |
| --- | --- |
| dziś | 14,0 mies. |
| ×1,5 | 12,3 mies. |
| ×2 | **13,0 mies.** |
| ×3 i więcej | wszystko niewykonalne |

×2 jest **gorsze** niż ×1,5. Podniesienie sufitu podnosi próg otwarcia fazy, więc
projekty dłużej czekają na skompletowanie załogi. Wniosek dla implementacji:
sufitów nie wolno skalować hurtem — trzeba je podnosić po jednym kroku i mierzyć,
dokładnie tak, jak robi to dzisiejszy autopilot sufitów.

## Co ten tryb ma robić naprawdę

Nie „ignoruj sufity", tylko **zatrudniaj i przekrój pracę inaczej — w jednej
propozycji**. Obie dźwignie działają tylko razem: więcej ludzi sprawia, że wyższy
sufit da się w ogóle obsadzić.

| | plan |
| --- | --- |
| dziś | 14,0 mies. |
| +4 etaty, sufity bez zmian | 8,9 mies. |
| same sufity | gorzej albo niewykonalne |
| **+4 etaty i podniesione sufity** | **6,3 mies.** |

Te 2,6 miesiąca różnicy między 8,9 a 6,3 to cała racja bytu tego trybu.

## Ustalenia (potwierdzone, nie do renegocjacji)

- **UX: najwyżej 1 osoba na projekt.** Z doświadczenia zespołu — dwóch designerów
  na jednym projekcie nie pracuje szybciej. Sufit UX nigdy nie jest podnoszony.
- **TL: najwyżej 1 osoba na projekt.** Ta sama zasada.
- **SEC: najwyżej 1 osoba na projekt.** Ta sama zasada.
- **PM i QA wolno podnosić.** Ich 1,0 w macierzy to domyślna wartość, której
  nikt nie ruszał, nie realne ograniczenie projektowe.
- **Górna granica podniesień: 3,0 na projekt** — górny stop paska sufitów w
  Wycenach. Planer nie proponuje sufitu powyżej tej wartości.
- **Sufity w macierzy to propozycje obsady, nie twarde estymaty.** Zostały
  wpisane jako „tylu ludzi możemy tu dziś postawić" — jeśli zatrudnimy nowych,
  wolno próbować dokładać. Podniesienie sufitu jest więc zwykłym ruchem
  planistycznym, nie nadpisaniem czyjejś świadomej decyzji; wystarczy lista
  zmian przy wariancie, bez osobnego oznaczania „zmiana estymaty". Wyjątkiem są
  UX, TL i SEC — tam jedynka opisuje projekt, dlatego stoją na liście
  zakazanych.
- **Terminy są miękkie.** To znaczniki na osi czasu do ręcznej korekty, nie cel
  optymalizacji. Liczbę przekroczonych terminów pokazujemy, ale żadne narzędzie
  na niej nie rankuje.
- **Wspólny zbiór reguł: `src/lib/planRules.ts`.** Definicja „lepszego planu"
  (`PlanScore`, `compareScores`: niewykonalne → horyzont → suma końców) i
  reguły podnoszenia sufitów (lista zakazana UX/TL/SEC, granica 3,0, krok 0,5,
  strażnik puli) żyją w jednym module. Planer zatrudnienia i autopilot w
  Wycenach już z niego korzystają — autopilot przez to sam odmawia podnoszenia
  UX/TL/SEC i nie wychodzi ponad 3,0 — a tryb 2 dostaje te same reguły za
  darmo. To zamyka rozjazd celów między narzędziami z krytyki projektu.
- Stan macierzy to potwierdza: wszystkie 13 komórek UX i 26 komórek TL stoi dziś
  dokładnie na 1,0. Powyżej jedynki wychodzą tylko BE (do 2,5) i FE (do 1,5).
- **Podniesione sufity zapisują się w wariancie** i są widoczne na ekranie —
  wariant przestaje być samym wektorem FTE.

Uwaga, która się z tego bierze: limit „1 UX na projekt" **nie** znaczy „nie ma
sensu zatrudniać UX-ów". Trzech UX-ów obsługuje trzy projekty równolegle. Limit
na projekt i limit na zespół to dwie różne rzeczy i obie są potrzebne:

- **limit zespołowy** (`caps`, gotowy) — ilu ludzi tej kompetencji w ogóle
  zatrudniamy („jeden TL i koniec"),
- **limit projektowy** (do zrobienia) — ilu ma sens na jednym projekcie naraz
  („jeden UX na projekt").

## Algorytm (rozstrzygnięty po krytyce)

Sufity są **darmowe**, etaty **kosztują**. To rozstrzyga strukturę: oś drabinki
zostaje „ile osób zatrudniamy", a przekrojenie pracy dzieje się przy okazji, na
każdym szczeblu. Pierwotny szkic („beam z trybu 1 + pętla autopilota naraz")
przeszedł krytykę i cztery rzeczy zostały rozstrzygnięte inaczej:

**1. Zespoły z beama trybu 1 — nie własny wybór etatów.** (Rewizja po
pomiarze.) Pierwsza wersja prowadziła jedną zachłanną ścieżkę: sama wybierała
najlepszy pojedynczy etat na tle podniesionych sufitów, z podpowiedzią z ruchów
zablokowanych pulą. Na realnym portfelu zdegenerowała się całkowicie:
pojedyncze etaty są płaskie nawet na podniesionych sufitach — pary jak TL+BE
płacą dopiero razem — więc remis rozstrzygał porządek kompetencji i planer
zatrudniał PM siedem razy. Przetrwanie płaskich poziomów to dokładnie to, po co
istnieje beam trybu 1, więc tryb 2 bierze zespół każdego szczebla wprost z
niego; własną robotą trybu 2 jest świeża pętla sufitowa na każdym z tych
zespołów. Zaakceptowany kompromis: beam optymalizuje skład przy dzisiejszych
sufitach, więc skład najlepszy dopiero-z-sufitami może umknąć — wersja dokładna
(pętla sufitowa na każdego kandydata beama) kosztuje minuty, nie sekundy.

**2. Sufity liczone od zera na każdym szczeblu.** Podniesienia NIE kumulują się
między szczeblami: szczebel N dostaje pętlę sufitową od czystej macierzy dla
swojego zespołu. Powód: podniesienie opłacalne przy małym zespole może szkodzić
przy większym (próg otwarcia fazy — pomiar ×1,5 vs ×2), a pętla umie tylko
podnosić. Bez kumulacji nie ma czego odkręcać, a każdy szczebel jest
samodzielną odpowiedzią: „N etatów + ten komplet podniesień". Konsekwencja:
komplety z sąsiednich szczebli nie muszą się zawierać — ekran pokazuje komplet
szczebla w całości, bez narracji „i jeszcze jedno podniesienie".

**3. Budżet symulacji.** Kształt po rewizji: beam trybu 1 (~150 symulacji) plus
osiem świeżych pętli sufitowych z małym budżetem ruchów na szczebel
(`MAX_MOVES_PER_RUNG` = 6). Zmierzone na realnym portfelu (28 projektów w
planie): ~1100 symulacji, ~38 s — dużo ponad budżet 2 s starego ekranu, więc
liczy się krokowo z paskiem postępu i przyciskiem „Przerwij". Do rozważenia
kiedyś: szybsza symulacja albo pętle sufitowe liczone leniwie od najniższych
szczebli.

**4. Szczebel zero istnieje.** Wiersz „0 etatów, same podniesienia" — pętla
sufitowa na dzisiejszym zespole potrafi znaleźć realne skróty (wiersz „same
sufity gorzej" w tabeli wyżej mierzył skalowanie hurtem, nie ruchy po kroku).

Runda dla szczebla N (dla jasności, po rozstrzygnięciach):

1. zespół szczebla N = najlepszy rozdział N etatów według beama trybu 1,
2. od czystej macierzy wyczerp opłacalne podniesienia dla tego zespołu
   (`ceilingRaiseBlock` + `compareScores` z `planRules.ts`, tylko komórki
   wyznaczające tempo, każde zweryfikowane pełną symulacją),
3. zapisz szczebel: zespół, komplet podniesień, `PlanScore`.

Wiersz wyniku brzmi: *„4 etaty — UX×2, BE, FE — plus sufity: ACMS·BE 2→3,
WTR·BE 2→2,5 → 6,3 mies."*.

Zmierzone po zbudowaniu, na realnym portfelu: baza 12,3 mies.; szczebel 0
(same podniesienia) 10,6; 5 etatów bez sufitów 8,7, z sufitami **7,7** — lepiej
niż 7 etatów bez sufitów (7,6 vs 7,3 z sufitami). Obie dźwignie faktycznie
składają się w jedną propozycję. Szczeble nie muszą być monotoniczne (szczebel
3 bywa odrobinę gorszy od 2 na sumie końców — artefakt kompromisu z pkt. 1);
ekran i tak przycina wiersze, które nic nie kupują.

## Trwałość i ekran

Dziś `TeamVariant` to `{ id, label, fte }`. Musi dojść nadpisanie sufitów per
projekt × kompetencja — nowa tabela `variant_project_ceiling (variant_id,
project_id, capability, max_fte)` i zwykły lockstep czterech plików
(`server/index.ts`, `server/repo.ts`, `src/db/repository.ts`,
`src/db/httpRepo.ts`) plus reducer.

Skutki uboczne do przemyślenia przy wdrożeniu:

- symulacja wariantu musi brać `cells` z nałożonym nadpisaniem, wszędzie tam,
  gdzie dziś bierze same `cells` (Symulacje liczą warianty w pętli),
- wariant z nadpisaniami powinien to widocznie sygnalizować — licznik przy
  nazwie i lista zmian („ACMS · BE 2 → 3") na ekranie,
- wariant roster-derived (`variant-1`) nadpisań nie ma i mieć nie powinien,
- **nadpisanie działa tylko w górę**: przechowywana jest wartość bezwzględna,
  więc gdy ktoś później podniesie realną macierz ponad nadpisanie, stare
  nadpisanie stałoby się po cichu *obniżeniem* — dlatego nadpisanie niższe lub
  równe bazie jest ignorowane (i można je przy okazji sprzątnąć),
- Wyceny pokazują macierz **realną**; nadpisania żyją tylko w Symulacjach, więc
  trzeba zdecydować, czy da się je stamtąd „wypchnąć" do macierzy jednym
  kliknięciem, czy tylko przeczytać i przepisać ręcznie.

Otwartych pytań nie ma — wszystkie trzy z pierwszej wersji notatki zostały
rozstrzygnięte i przeniesione do ustaleń powyżej.
