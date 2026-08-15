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

## Szkic algorytmu

Sufity są **darmowe**, etaty **kosztują**. To rozstrzyga strukturę: oś drabinki
zostaje „ile osób zatrudniamy", a przekrojenie pracy dzieje się przy okazji, na
każdym szczeblu.

Runda dla poziomu N:

1. Wyczerp opłacalne podniesienia sufitów na obecnym zespole — po jednym kroku
   (0,5), tylko na komórkach wyznaczających tempo, każde zweryfikowane pełną
   symulacją. To dokładnie pętla z `autopilot.ts`, więc do napisania jest
   wpięcie, nie nowa matematyka.
2. Dołóż najlepszy jeden etat (dzisiejszy beam z `hiringPlanner.ts`).
3. Wróć do 1 — nowa osoba mogła właśnie uczynić kolejny sufit obsadzalnym.

Wiersz wyniku brzmi wtedy: *„4 etaty — UX×2, BE, FE — plus sufity: ACMS·BE 2→3,
WTR·BE 2→2,5 → 6,3 mies."*.

Kandydaci na podniesienie:

- tylko kompetencje spoza listy zakazanych (dziś: nie UX, nie TL, nie SEC),
- tylko komórki, które faktycznie wyznaczają tempo fazy — podniesienie sufitu z
  zapasem nie zmienia niczego i autopilot już to wie,
- do granicy 3,0 na projekt × kompetencję,
- podniesienie, które czyni projekt niewykonalnym, odpada samo — poziom
  `impossible` w `PlanScore` jest nadrzędny.

Koszt: ruchy sufitowe są ograniczone (`MAX_MOVES`), a drabinka ma 7 szczebli.
Trzeba zmierzyć, czy mieści się w budżecie UX-owym dzisiejszego trybu (~2 s przy
~120 symulacjach). Jeśli nie — liczyć sufity tylko na wybranym szczeblu, na
żądanie, zamiast na wszystkich siedmiu.

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
- Wyceny pokazują macierz **realną**; nadpisania żyją tylko w Symulacjach, więc
  trzeba zdecydować, czy da się je stamtąd „wypchnąć" do macierzy jednym
  kliknięciem, czy tylko przeczytać i przepisać ręcznie.

## Otwarte pytania

1. **Czy podniesienie sufitu to zmiana estymaty?** Jeśli „max 1 UX" opisuje
   projekt, a nie zespół, to propozycja podniesienia jest twierdzeniem o tym, że
   pracę da się pokroić inaczej. Ekran powinien to mówić wprost, zamiast po
   cichu przepisywać liczby, które ktoś świadomie wpisał.
