import { ContainerPF2e, ItemPF2e, PhysicalItemPF2e } from "@item/index";
import { Price } from "@item/physical/data";
import { CoinsPF2e } from "@item/physical/helpers";
import { DENOMINATIONS } from "@item/physical/values";
import { UserPF2e } from "@module/user";
import { ErrorPF2e, isObject } from "@util";
import { UUIDUtils } from "@util/uuid-utils";
import { KitEntryData, KitSource, KitSystemData } from "./data";
import { Size } from "@module/data";
import { ActorSizePF2e } from "@actor/data/size";

class KitPF2e extends ItemPF2e {
    get entries(): KitEntryData[] {
        return Object.values(this.system.items);
    }

    get price(): Price {
        return {
            value: new CoinsPF2e(this.system.price.value),
            per: this.system.price.per ?? 1,
        };
    }

    /** Expand a tree of kit entry data into a list of physical items */
    override async createGrantedItems(
        options: { entries?: KitEntryData[]; containerId?: string; size?: Size } = {}
    ): Promise<PhysicalItemPF2e[]> {
        const size = new ActorSizePF2e({ value: options.size ?? "med", smallIsMedium: true }).value;
        const entries = options.entries ?? this.entries;
        const itemUUIDs = entries.map((e): ItemUUID => e.uuid);
        const items: unknown[] = await UUIDUtils.fromUUIDs(itemUUIDs);
        if (entries.length !== items.length) throw ErrorPF2e(`Some items from ${this.name} were not found`);
        if (!items.every((i): i is ItemPF2e => i instanceof ItemPF2e)) return [];

        return items.reduce(async (promise: PhysicalItemPF2e[] | Promise<PhysicalItemPF2e[]>, item, index) => {
            const prepared = await promise;
            const clone = item.clone({ _id: randomID(), system: { size } }, { keepId: true });
            const entry = entries[index];
            if (clone instanceof PhysicalItemPF2e) {
                clone.updateSource({
                    "system.quantity": entry.quantity,
                    "system.containerId": options.containerId,
                });
            }

            if (clone instanceof ContainerPF2e && entry.items) {
                const contents = await this.createGrantedItems({
                    entries: Object.values(entry.items),
                    containerId: clone.id,
                    size,
                });
                prepared.push(clone, ...contents);
            } else if (clone instanceof KitPF2e) {
                const inflatedKit = await clone.createGrantedItems({ containerId: options.containerId, size });
                prepared.push(...inflatedKit);
            } else if (clone instanceof PhysicalItemPF2e) {
                prepared.push(clone);
            }

            return prepared;
        }, []);
    }

    protected override async _preUpdate(
        changed: DeepPartial<this["_source"]>,
        options: DocumentModificationContext<this>,
        user: UserPF2e
    ): Promise<void> {
        if (!changed.system) return await super._preUpdate(changed, options, user);

        // Clear 0 price denominations
        if (isObject<Record<string, unknown>>(changed.system?.price)) {
            const price: Record<string, unknown> = changed.system.price;
            for (const denomination of DENOMINATIONS) {
                if (price[denomination] === 0) {
                    price[`-=denomination`] = null;
                }
            }
        }

        await super._preUpdate(changed, options, user);
    }
}

interface KitPF2e extends ItemPF2e {
    readonly _source: KitSource;
    system: KitSystemData;
}

export { KitPF2e };
