# PokéAPI domain fixtures

`domain-captures.json` contains responses captured from `https://pokeapi.co/api/v2/` on 2026-09-30. Evolution chains 1, 2, 47, 67, 280, 287, 352, and 362 retain every upstream field and alternative. The item, Pokémon, species, and ability entries retain the fields consumed by the dossier and item services; English text entries are selected and Pokémon move lists are limited to two entries to keep these domain tests focused.

`syntheticDetail` deliberately populates every documented evolution-detail field, including conditional-expression data absent from the captured chains. Tests that attach another chain to the Bulbasaur fixture are normalization probes, not Pokémon game-data claims.

Shape references: [EvolutionDetail](https://pokeapi.co/docs/v2/#evolution-chains), [ItemPrice](https://pokeapi.co/docs/v2/#items).

`resolution-captures.json` contains successful PokéAPI responses captured on 2026-10-14: Deoxys and Wormadam records, species, dependencies, type memberships, and generation lists. Records retain the fields read by the service; Pokémon moves are limited to two entries, and species/ability text is English-only. Complete type and generation memberships preserve the Psychic/Generation III intersection of 20 species.

`handler-fixtures.ts` combines these captures with `domain-captures.json` and explicit synthetic records for the nine handler/resource suites. Synthetic dossiers copy non-identity fields solely to exercise wiring; those fields are not assertions about game data. Synthetic move, nature, and type payloads model fields consumed by each handler. Unknown test identifiers have explicit HTTP 404 routes. Every fixture uses `createFetchMock`, and `tests/setup.ts` fails unmatched fetch attempts even when handler error conversion catches the thrown error. The default lane never reaches the network; deliberate live checks run separately.
