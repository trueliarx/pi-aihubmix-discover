# pi-aihubmix-discover

AiHubMix provider extension for the Pi Coding Agent.

## Install

```
pi install git:github.com/yourusername/pi-aihubmix-discover@main
```

Or locally:

```
pi install ./pi-aihubmix-discover
```

## Usage

Run `/aihubmix-models-sync`. On first run, you'll be prompted for your AiHubMix API key. Models are discovered and registered automatically.

To change the key later, use `/login` -- aihubmix will be listed.

## Commands

- `/aihubmix-models-sync` -- re-fetch models from AiHubMix API
