# @tgbotpress/plugin-transit

Transit plugin package. Current pure entries are:

- `./rates` for fixed-point exchange-rate calculations.
- `./units` for four-decimal wallet amount parsing and formatting.
- `./poll` for USDT polling lower-bound timestamp calculation.
- `./private-key` for RSA-OAEP encryption of wallet private keys. The host supplies the public key PEM; the package never reads environment variables or key files.

These entries have no database, network, wallet-key, or Telegram side effects. The remaining wallet APIs and workers are still hosted by TGBotPress and will be migrated after their transaction and key-management contracts are defined.
