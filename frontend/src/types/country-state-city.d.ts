declare module "country-state-city" {
  export interface ICountry {
    name: string;
    isoCode: string;
    latitude?: string;
    longitude?: string;
    phonecode?: string;
    flag?: string;
    currency?: string;
  }

  export interface IState {
    name: string;
    isoCode: string;
    countryCode?: string;
    latitude?: string;
    longitude?: string;
  }

  export interface ICity {
    name: string;
    latitude?: string;
    longitude?: string;
    countryCode?: string;
    stateCode?: string;
  }

  export const Country: {
    getAllCountries(): ICountry[];
  };

  export const State: {
    getStatesOfCountry(countryCode: string): IState[];
  };

  export const City: {
    getCitiesOfState(countryCode: string, stateCode: string): ICity[];
    getCitiesOfCountry(countryCode: string): ICity[];
  };
}
