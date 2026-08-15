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

**1. Zachłannie, szerokość 1 — nie beam.** Beam trzyma cztery różne zespoły na
poziom; „wyczerp sufity na obecnym zespole" nie ma wtedy adresata, a pętla
sufitowa na każdy węzeł to minuty zamiast sekund. Tryb 2 prowadzi jedną ścieżkę.
Ubezpieczenie, które dawał beam (etat opłacalny dopiero w towarzystwie), w
dużej mierze przejmują sufity: to one przywracają gradient, przez którego brak
drabinka trybu 1 była płaska.

**2. Sufity liczone od zera na każdym szczeblu.** Podniesienia NIE kumulują się
między szczeblami: szczebel N dostaje pętlę sufitową od czystej macierzy dla
swojego zespołu. Powód: podniesienie opłacalne przy małym zespole może szkodzić
przy większym (próg otwarcia fazy — pomiar ×1,5 vs ×2), a pętla umie tylko
podnosić. Bez kumulacji nie ma czego odkręcać, a każdy szczebel jest
samodzielną odpowiedzią: „N etatów + ten komplet podniesień". Konsekwencja:
komplety z sąsiednich szczebli nie muszą się zawierać — ekran pokazuje komplet
szczebla w całości, bez narracji „i jeszcze jedno podniesienie".

**3. Budżet symulacji.** Uczciwy rachunek pełnej wersji (~1300 symulacji ≈ 20 s
przy ~14 ms/symulację) nie mieści się w budżecie ekranu (~2 s), a „licz sufity
dopiero po kliknięciu szczebla" łamie własną rację bytu trybu: bez sufitów
etaty 2–7 są remisowe, więc dobór ludzi byłby losowy. Środek: pętla sufitowa ma
mały budżet na szczebel (`MAX_MOVES_PER_RUNG`, ~6), kandydaci na etat są
punktowani jedną symulacją na tle podniesionych sufitów rodzica, plus jedna
symulacja podpowiedzi: pętla sufitowa raportuje ruchy zablokowane pulą
(`blocked: "pool"`), więc etat, który taki ruch odblokowuje, testujemy razem z
nim. Cel: ~500–600 symulacji, krokowo jak dziś (`SIMS_PER_STEP`).

**4. Szczebel zero istnieje.** Wiersz „0 etatów, same podniesienia" — pętla
sufitowa na dzisiejszym zespole potrafi znaleźć realne skróty (wiersz „same
sufity gorzej" w tabeli wyżej mierzył skalowanie hurtem, nie ruchy po kroku).

Runda dla szczebla N (dla jasności, po rozstrzygnięciach):

1. weź zespół szczebla N−1 plus najlepszy jeden etat (punktacja jak w pkt. 3),
2. od czystej macierzy wyczerp opłacalne podniesienia dla tego zespołu
   (`ceilingRaiseBlock` + `compareScores` z `planRules.ts`, tylko komórki
   wyznaczające tempo, każde zweryfikowane pełną symulacją),
3. zapisz szczebel: zespół, komplet podniesień, `PlanScore`.

Wiersz wyniku brzmi: *„4 etaty — UX×2, BE, FE — plus sufity: ACMS·BE 2→3,
WTR·BE 2→2,5 → 6,3 mies."*.

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
