.PHONY: install db up down prod migrate dev test typecheck eval logs

install:
	cd backend && npm install

db:
	docker compose up -d db

up:
	docker compose up -d --build

down:
	docker compose down

prod:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

migrate:
	cd backend && npm run migrate

dev:
	cd backend && npm run dev

test:
	cd backend && npm test

typecheck:
	cd backend && npm run typecheck

eval:
	cd backend && npm run eval

logs:
	docker compose logs -f backend
