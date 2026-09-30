# PokéAPI domain fixtures

`domain-captures.json` contains responses captured from `https://pokeapi.co/api/v2/` on 2026-09-30. Evolution chains 1, 2, 47, 67, 280, 287, 352, and 362 retain every upstream field and alternative. The item, Pokémon, species, and ability entries retain the fields consumed by the dossier and item services; English text entries are selected and Pokémon move lists are limited to two entries to keep these domain tests focused.

`syntheticDetail` deliberately populates every documented evolution-detail field, including conditional-expression data absent from the captured chains. Tests that attach another chain to the Bulbasaur fixture are normalization probes, not Pokémon game-data claims.

Shape references: [EvolutionDetail](https://pokeapi.co/docs/v2/#evolution-chains), [ItemPrice](https://pokeapi.co/docs/v2/#items).
