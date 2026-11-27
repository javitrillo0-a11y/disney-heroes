class BattleSystem {
    constructor(playerCharacter, enemyCharacter) {
        this.player = {
            character: playerCharacter,
            health: 100,
            maxHealth: 100,
            energy: 3,
            maxEnergy: 3
        };
        
        this.enemy = {
            character: enemyCharacter,
            health: 100,
            maxHealth: 100
        };
        
        this.isPlayerTurn = true;
        this.battleActive = false;
        this.onBattleEnd = null;
        this.onLog = null;
    }

    start() {
        this.battleActive = true;
        this.isPlayerTurn = true;
        this.player.health = 100;
        this.player.energy = 3;
        this.enemy.health = 100;
        
        this.player.character.setAnimation('idle', true);
        this.enemy.character.setAnimation('idle', true);
        
        this.log('¡La batalla comienza!');
        this.updateUI();
    }

    async playerAction(skillName) {
        if (!this.isPlayerTurn || !this.battleActive) return;
        
        const skillCost = this.getSkillCost(skillName);
        if (this.player.energy < skillCost) {
            this.log('¡No tienes suficiente energía!');
            return;
        }
        
        this.player.energy -= skillCost;
        this.isPlayerTurn = false;
        
        // Ejecutar animación del jugador
        await this.executeSkill(this.player.character, skillName, true);
        
        // Calcular daño
        const damage = this.calculateDamage(skillName);
        this.enemy.health = Math.max(0, this.enemy.health - damage);
        this.log(`¡Atacas por ${damage} de daño!`);
        
        this.updateUI();
        
        // Verificar victoria
        if (this.enemy.health <= 0) {
            await this.playerVictory();
            return;
        }
        
        // Turno del enemigo
        setTimeout(() => this.enemyTurn(), 1000);
    }

    async enemyTurn() {
        if (!this.battleActive) return;
        
        this.log('Turno del enemigo...');
        
        await this.executeSkill(this.enemy.character, 'attack', false);
        
        const damage = Math.floor(Math.random() * 15) + 10;
        this.player.health = Math.max(0, this.player.health - damage);
        this.log(`¡El enemigo ataca por ${damage} de daño!`);
        
        this.updateUI();
        
        if (this.player.health <= 0) {
            await this.playerDefeat();
            return;
        }
        
        // Recuperar energía y pasar turno
        this.player.energy = Math.min(this.player.maxEnergy, this.player.energy + 1);
        this.isPlayerTurn = true;
        this.updateUI();
    }

    async executeSkill(character, skillName, isPlayer) {
        return new Promise((resolve) => {
            const animationName = skillName === 'attack' ? 'attack' : skillName;
            
            character.setAnimation(animationName, false);
            
            character.animationState.setCompleteListener(() => {
                character.setAnimation('idle', true);
                setTimeout(resolve, 500);
            });
        });
    }

    calculateDamage(skillName) {
        const baseDamage = {
            'attack': 15,
            'skill1': 25,
            'skill2': 30,
            'skill3': 50
        };
        
        const variation = Math.floor(Math.random() * 10) - 5;
        return Math.max(1, (baseDamage[skillName] || 15) + variation);
    }

    getSkillCost(skillName) {
        const costs = {
            'attack': 1,
            'skill1': 2,
            'skill2': 2,
            'skill3': 3
        };
        return costs[skillName] || 1;
    }

    async playerVictory() {
        this.battleActive = false;
        this.log('¡VICTORIA!');
        await this.executeSkill(this.player.character, 'victory_loop', true);
        
        if (this.onBattleEnd) {
            setTimeout(() => this.onBattleEnd(true), 3000);
        }
    }

    async playerDefeat() {
        this.battleActive = false;
        this.log('¡DERROTA!');
        await this.executeSkill(this.player.character, 'death', false);
        
        if (this.onBattleEnd) {
            setTimeout(() => this.onBattleEnd(false), 3000);
        }
    }

    log(message) {
        if (this.onLog) {
            this.onLog(message);
        }
    }

    updateUI() {
        const playerHealthPercent = (this.player.health / this.player.maxHealth) * 100;
        const playerEnergyPercent = (this.player.energy / this.player.maxEnergy) * 100;
        const enemyHealthPercent = (this.enemy.health / this.enemy.maxHealth) * 100;
        
        document.getElementById('player-health').style.width = playerHealthPercent + '%';
        document.getElementById('player-health-text').textContent = 
            `${this.player.health}/${this.player.maxHealth}`;
        
        document.getElementById('player-energy').style.width = playerEnergyPercent + '%';
        document.getElementById('player-energy-text').textContent = 
            `${this.player.energy}/${this.player.maxEnergy}`;
        
        document.getElementById('enemy-health').style.width = enemyHealthPercent + '%';
        document.getElementById('enemy-health-text').textContent = 
            `${this.enemy.health}/${this.enemy.maxHealth}`;
        
        // Actualizar botones de habilidades
        document.querySelectorAll('.skill-btn').forEach(btn => {
            const cost = parseInt(btn.dataset.cost);
            btn.disabled = !this.isPlayerTurn || this.player.energy < cost;
        });
        
        document.getElementById('turn-indicator').textContent = 
            this.isPlayerTurn ? 'Tu turno' : 'Turno enemigo';
    }
}