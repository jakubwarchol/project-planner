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

Zastrzeżenie z dyskusji: kolejność bywa nienegocjowalna. Zależności techniczne
i ograniczenia kalendarzowe już są twarde (`blockedBy`, `earliestStartDate`);
dla decyzji odgórnych potrzebne jest **przypinanie** — projekt (albo cała góra
backlogu) zablokowany na pozycji, optymalizator permutuje tylko resztę. Przy w
pełni sztywnej kolejności ta sama maszyneria działa jako **wycennik narzuconego
porządku**: diff „kolejność narzucona vs najlepsza znaleziona" pokazuje, ile
kosztuje utrzymanie priorytetów — spóźnienie przestaje być porażką zespołu,
a staje się wycenioną, świadomą decyzją.

### 7. Optymalizator składu zespołu

Docelowa forma analizy wrażliwości pul i sufitów (to jedno pytanie, nie dwa):
**przy ustalonym portfelu i ustalonej kolejności — jak rozłożyć zespół, żeby
całość poszła jak najszybciej.** Rozstrzygnięcia z dyskusji (sierpień 2026):

- **Cel: suma dat końca wszystkich projektów** (wszystko średnio wcześniej),
  z deadline'ami jako warunkiem nadrzędnym. Sam makespan ignoruje wszystko
  poza jednym maruderem.
- **Założenie wymienialności ludzi** — model jest teoretyczny; zespół to suma
  FTE do rozłożenia po kompetencjach, bez pytania kto co potrafi.
- **Główna gałka: redystrybucja FTE między pulami**, zero-sum na obecnym
  pogłowiu. Dopuszczalne 2–3 punkty zmiany w czasie (popyt przesuwa się z faz
  inicjacji na wytwarzanie), z **karą za każdą zmianę** — ludzie to nie suwaki;
  mało ruchów, grubych i stabilnych.
- **Zatrudnianie osobno** — to ciężka decyzja, więc „co by dało +1 FTE i
  gdzie" jest oddzielnym raportem obok propozycji, nie wmieszanym w nią.
- **Sufity (`maxFte`) są raportowane, nie manipulowane.** Sufit to własność
  pracy (jak drobno się dzieli), nie przypisanie ludzi — wolna zmienna
  podkręciłaby wszystkie sufity do nieba (Goodhart) i plan przestałby opisywać
  rzeczywiste projekty. Zamiast tego raport: „ten sufit ogranicza portfel;
  inne pokrojenie pracy w projekcie X dałoby N tygodni".

Mechanika: zachłanna pętla po diagnostyce, którą scheduler już produkuje —
okresy czekania mają winne kompetencje i powód (`pool` vs `crew`), strumień
nadający tempo jest oznaczony (`setsPace`). Symulacja → mapa gardeł w czasie →
ruchy kandydujące tylko na gardło → ocena każdego symulacją (~14 ms) → najlepszy
→ powtórz. Kluczowe rozróżnienie: gardło **puli** leczy się przesunięciem FTE,
gardło **sufitu** — nie (dokładanie ludzi nie daje nic; do raportu).

Po wysyceniu redystrybucji (marginalne zyski wyrównane między pulami) planem
rządzą wyłącznie sufity — więc wynik ma dwie części: ruchy w składzie (do
wykonania) i listę sufitów wartych zakwestionowania (do przemyślenia).

Diagnostyk spinający: suma dni nakładu / łączne efektywne FTE miesięcznie =
**absolutne minimum czasu portfela**. Różnicę plan − minimum można rozłożyć na
przyczyny (sufity, fazowanie, urlopy) — od razu widać, ile jest do ugrania.

Zależność: sensowna wycena zatrudnień wymaga zmiennego zespołu z ramp-upem
(punkt 2) — inaczej „+1 BE od października" będzie zawsze zawyżone.

Zasady wspólne wszystkich optymalizatorów: **propozycja z cennikiem, nigdy
auto-zastosowanie**, i zawsze widać, kto traci. Oraz: **nie optymalizujemy
urlopów** — technicznie ta sama maszyneria, ale zamienia narzędzie planistyczne
w narzędzie nacisku na ludzi; urlopy pozostają danymi wejściowymi.

### 8. Kwantyzacja etatów do ćwiartek

Wszystkie **decyzje** etatowe w kroku 0,25: alokacje osób w Zespole,
przypisania w Obsadzie, sufity `maxFte`, ruchy optymalizatora składu. Zyski:

- przestrzeń przeszukiwania optymalizatora robi się skończona i mała, a
  propozycje wykonalne — „przesuń 0,25 do QA" to decyzja, „przesuń 0,2137"
  to szum; ćwiartka to minimalny „gruby, stabilny ruch",
- znika fałszywa precyzja z danych wejściowych.

**Nie kwantyzować wielkości wyliczanych.** FTE strumieni z modelu załogi są
ciągłe z konstrukcji (kompetencja nadająca tempo biegnie na suficie, reszta
dorzeźbiona, żeby skończyć razem — 0,63 FTE to średnie tempo fazy, nie obsada
ułamka człowieka), a przypadki skrajne już mają mechanizm zrywu (`minCrewFte`).
Ćwiartki dotyczą etatów nagłówkowych — pule efektywne po przemnożeniu przez
produktywność pozostają ciągłe, i słusznie.

Implementacja: krok 0,25 w polach liczbowych + granulacja ruchów
optymalizatora; ewentualnie ustawienie „krok etatu", gdyby teoretyczny
eksperyment potrzebował drobniej.

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
- **Auto-przydział w Obsadzie** — inna matematyka niż przeszukiwanie symulacji:
  klasyczne dopasowanie (przepływy / zachłanne z naprawą) proponujące komplet
  przypisań z okien zapotrzebowania — minimalizuje luki i nadprzydziały,
  preferuje ciągłość (mniej projektów na osobę naraz). Propozycja do
  akceptacji; człowiek poprawia to, czego algorytm nie wie.
- **Optymalizator zakresu („co wyciąć")** — gdy deadline'y się nie spinają,
  enumeracja małych podzbiorów projektów do zaparkowania (przy 12 projektach
  wszystkie pojedyncze i pary to ~78 symulacji ≈ sekunda): „wyłączenie X ratuje
  deadline'y Y i Z". Lustrzanie: „czy nowy projekt zmieści się bez psucia
  czegokolwiek, a jak nie — co dokładnie zepsuje".
- **Ratownik deadline'ów** — parasol nad wszystkimi dźwigniami: dla padającego
  deadline'u posortowana lista najtańszych ruchów (zamiana w kolejności /
  zmiana składu / zaparkowanie projektu / nowy realny termin), każda z ceną
  z diffu dwóch symulacji. Ma sens dopiero, gdy istnieją pojedyncze
  optymalizatory, z których czerpie.
- **Ostrzeżenie o produktywności obsady** — plan liczy stawkę ze *średniej*
  produktywności puli, a Obsada przypisuje *konkretnych* ludzi. Gdy ważony
  focus przypisanych odbiega istotnie od średniej użytej w planie, pokrycie
  formalnie się zgadza, ale czas trwania jest dla tego projektu zbyt
  optymistyczny (lub pesymistyczny). Sygnał w Obsadzie, bez ruszania dat —
  zgodnie z zasadą, że przypisania nie wracają do schedulera.

## Sugerowana kolejność wdrażania

1. **Zmienny zespół z ramp-upem** — bez niego Symulacje odpowiadają nieprecyzyjnie
   na swoje główne pytanie, a koszt jest niski.
2. **Snapshoty** — im wcześniej zaczną się zbierać, tym szybciej będzie z czego
   kalibrować.
3. **Pozostały nakład** — gdy model zacznie być używany na bieżąco, a nie do
   jednorazowego planowania.
4. **Optymalizator składu zespołu** — najlepiej dopasowany do realnego użycia
   (kolejność przyjmuje jako daną); tryb zatrudnieniowy dopiero po punkcie 1.
5. Dalej według potrzeb: praca stała, niepewność, optymalizator kolejności,
   reszta.
