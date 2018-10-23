import uid from 'uid'
import {TriggerRental, GENERIC} from "../constants";

class GenericStrategy {
	constructor(settings){
		this.type = GENERIC

		this.uid = settings.uid || uid()
		this.emitter = settings.emitter
	}

	onRentalTrigger(rentalFunction){
		this.emitter.on("TriggerRental", rentalFunction)
	}

	setUID(id) {
		this.uid = id
	}

	getUID(){
		return this.uid
	}

	getInternalType() {
		return this.type
	}

	static getType(){
		return GENERIC
	}

	serialize(){
		return {
			type: this.type,
			uid: this.uid
		}
	}
}

export default GenericStrategy
